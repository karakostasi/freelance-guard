// Tests of the mainnet deploy script and of the check that reads a deployment back, on a throwaway local chain. The chain
// is not a real-money network, so STRICT=1 holds the script to the rules of real money. Run with: npm run test:deploy
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import plan from "./lib/mainnet-plan.cjs";

const { planDeployment, units } = plan;
const PORT = process.env.TEST_DEPLOY_PORT ?? "8745";
const RPC = `http://127.0.0.1:${PORT}`;
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat #0: the deploying key
const deployer = privateKeyToAccount(KEY);
const artifact = (path) => JSON.parse(readFileSync(new URL(`../artifacts/contracts/${path}.json`, import.meta.url), "utf8"));
const escrowAbi = JSON.parse(readFileSync(new URL("../abi/FreelanceEscrow.json", import.meta.url), "utf8")).abi;

let failures = 0;
const check = (condition, message) => {
  console.log(condition ? "  PASS" : "  FAIL", message);
  if (!condition) failures++;
};

// ---------------------------------------------------------------- the rules, without a chain
console.log("The rules");
{
  const addr = (n) => `0x${String(n).padStart(40, "0")}`;
  const ok = { OWNER_ADDRESS: addr(1), ARBITER_ADDRESS: addr(2), TREASURY_ADDRESS: addr(3), REVIEW_PERIOD_DAYS: "3", USDC_MIN_FEE: "43", USDC_MIN_JOB: "2174", EURC_MIN_FEE: "40", EURC_MIN_JOB: "2000" };
  const asks = (env, network = "base", key = addr(9)) => planDeployment({ ...ok, ...env }, network, key);
  const says = (r, text) => r.errors.some((e) => e.includes(text));
  check(asks({}).plan?.tokens.USDC.address === "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" && asks({}).plan.reviewPeriodSeconds === 3 * 86400, "a complete setting makes a plan, with Circle's USDC for Base");
  check(asks({}).plan.tokens.EURC.cfg.minFee === 40_000_000n && asks({}).plan.tokens.EURC.cfg.vault === "0x0000000000000000000000000000000000000000", "the limits are in whole tokens, and there is never a vault");
  check(units("2000.5") === 2_000_500_000n && units("40") === 40_000_000n, "amounts are read exactly, with no floating point");
  check(says(asks({ OWNER_ADDRESS: undefined }), "OWNER_ADDRESS") && says(asks({ ARBITER_ADDRESS: "0x123" }), "ARBITER_ADDRESS") && says(asks({ TREASURY_ADDRESS: "0x0000000000000000000000000000000000000000" }), "TREASURY_ADDRESS"), "the owner, the arbiter and the treasury have to be named, and be real addresses");
  check(says(asks({ ARBITER_ADDRESS: addr(1) }), "must be different"), "the owner and the arbiter can't be the same");
  for (const role of ["OWNER_ADDRESS", "ARBITER_ADDRESS", "TREASURY_ADDRESS"]) check(says(asks({ [role]: addr(9) }), "deploying key"), `the deploying key can't be the ${role.split("_")[0].toLowerCase()}`);
  check(says(asks({ REVIEW_PERIOD_DAYS: undefined }), "REVIEW_PERIOD_DAYS") && says(asks({ REVIEW_PERIOD_DAYS: "0" }), "REVIEW_PERIOD_DAYS") && says(asks({ REVIEW_PERIOD_DAYS: "30" }), "REVIEW_PERIOD_DAYS") && says(asks({ REVIEW_PERIOD_DAYS: "2.5" }), "REVIEW_PERIOD_DAYS"), "the review period has to be a whole number of days, within reason");
  check(says(asks({ USDC_MIN_FEE: undefined }), "USDC_MIN_FEE") && says(asks({ EURC_MIN_JOB: "abc" }), "EURC_MIN_FEE") && says(asks({ EURC_MIN_FEE: "0", EURC_MIN_JOB: "0" }), "above zero"), "the limits have to be named, and be numbers above zero");
  check(says(asks({ EURC_MIN_FEE: "101", EURC_MIN_JOB: "2000" }), "5%") && !says(asks({ EURC_MIN_FEE: "100", EURC_MIN_JOB: "2000" }), "5%"), "the smallest fee can't be more than 5% of the smallest job, as in the contract");
  check(says(asks({ SURCHARGE_BPS: "101" }), "SURCHARGE_BPS") && asks({ SURCHARGE_BPS: "50" }).plan?.surchargeBps === 50, "the surcharge is limited as in the contract");
  check(says(asks({ USDC_ADDRESS: "0x2222222222222222222222222222222222222222" }), "not Circle's USDC") && !says(asks({ USDC_ADDRESS: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }), "USDC_ADDRESS"), "a token that isn't Circle's is refused, in any letter case");
  check(says(asks({ MOCK_USDC: "1" }), "MOCK_USDC") && says(asks({ USDC_VAULT_ADDRESS: addr(5) }), "never sets a vault"), "mocks and a yield vault are refused");
  check(says(asks({ EXECUTE: "1" }), "CONFIRM_CHAIN_ID") && says(asks({ EXECUTE: "1", CONFIRM_CHAIN_ID: "84532" }), "CONFIRM_CHAIN_ID=8453") && !says(asks({ EXECUTE: "1", CONFIRM_CHAIN_ID: "8453" }), "CONFIRM_CHAIN_ID"), "to send for real the chain id has to be typed in as well");
  check(!says(asks({ EXECUTE: "1" }, "baseSepolia"), "CONFIRM_CHAIN_ID") && asks({ EXECUTE: "1" }, "baseSepolia").warnings.length > 0, "a rehearsal on a test network doesn't need that, and says it is a rehearsal");
  check(says(asks({ EXECUTE: "1", STRICT: "1" }, "baseSepolia"), "CONFIRM_CHAIN_ID"), "STRICT=1 holds a rehearsal to the same rule");
  check(says(asks({}, "ethereum"), "isn't a network"), "any other network is refused");
}

// ---------------------------------------------------------------- the scripts, on a chain
const dir = mkdtempSync(join(tmpdir(), "fg-deploy-"));
const children = [];
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
};
process.on("SIGINT", () => (stop(), process.exit(130)));

async function until(fn, what, ms = 30_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Runs one of the scripts on the local chain, with exactly these settings and no others. */
function run(script, env) {
  const r = spawnSync("npx", ["hardhat", "run", script, "--network", "localhost"], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ENV_FILE: "none", LOCAL_RPC_URL: RPC, DEPLOYMENTS_DIR: join(dir, "deployments"), ...env },
    encoding: "utf8",
  });
  return { code: r.status, text: `${r.stdout}\n${r.stderr}` };
}

try {
  console.log("\nStarting a local chain…");
  const chain = spawn("npx", ["hardhat", "node", "--port", PORT], { stdio: "ignore" });
  children.push(chain);
  await until(async () => (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).ok, "the chain");
  spawnSync("npx", ["hardhat", "compile", "--quiet"], { encoding: "utf8" });

  const chainOpts = { chain: hardhat, transport: http(RPC) };
  const pub = createPublicClient(chainOpts);
  const wallet = createWalletClient({ account: deployer, ...chainOpts });
  const make = async (path, args) => {
    const a = artifact(path);
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
  };
  const signer = (n) => `0x${"abc".padEnd(3, "0")}${String(n).padStart(37, "0")}`;
  const erc20 = "mocks/MockERC20.sol/MockERC20";
  const safe = "mocks/MockSafe.sol/MockSafe";
  const usdc = await make(erc20, ["USD Coin", "USDC", 6]);
  const eurc = await make(erc20, ["EURC", "EURC", 6]);
  const ownerSafe = await make(safe, [[signer(1), signer(2), signer(3)], 2n]);
  const arbiterSafe = await make(safe, [[signer(4), signer(5), signer(6)], 2n]);
  const weakSafe = await make(safe, [[signer(7), signer(8), signer(9)], 1n]);
  const allSafe = await make(safe, [[signer(10), signer(11)], 2n]);
  const deployerSafe = await make(safe, [[deployer.address, signer(12), signer(13)], 2n]);
  const overlapSafe = await make(safe, [[signer(1), signer(14), signer(15)], 2n]);
  const treasury = signer(20);

  const settings = {
    STRICT: "1",
    OWNER_ADDRESS: ownerSafe,
    ARBITER_ADDRESS: arbiterSafe,
    TREASURY_ADDRESS: treasury,
    REVIEW_PERIOD_DAYS: "3",
    USDC_ADDRESS: usdc,
    EURC_ADDRESS: eurc,
    USDC_MIN_FEE: "43",
    USDC_MIN_JOB: "2174",
    EURC_MIN_FEE: "40",
    EURC_MIN_JOB: "2000",
  };
  const deploy = (extra = {}) => run("scripts/deploy-mainnet.cjs", { ...settings, ...extra });
  const refused = (r, text) => r.code !== 0 && r.text.includes(text);

  console.log("\nThe deploy script refuses what is unsafe");
  check(refused(deploy({ OWNER_ADDRESS: deployer.address }), "deploying key"), "a deploying key that holds a role");
  check(refused(deploy({ OWNER_ADDRESS: signer(30) }), "is not a contract"), "an owner that is a plain key and not a multisig");
  check(refused(deploy({ ARBITER_ADDRESS: signer(31) }), "arbiter") && refused(deploy({ ARBITER_ADDRESS: signer(31) }), "is not a contract"), "an arbiter that is a plain key, which could never be changed");
  check(refused(deploy({ OWNER_ADDRESS: weakSafe }), "needs 1"), "a Safe where one signature is enough");
  check(refused(deploy({ OWNER_ADDRESS: allSafe }), "signers"), "a Safe with fewer than 3 signers");
  check(refused(deploy({ OWNER_ADDRESS: deployerSafe }), "signer of the owner Safe"), "a Safe where the deploying key is a signer");
  check(refused(deploy({ ARBITER_ADDRESS: overlapSafe }), "sign for both"), "the same people signing for the owner and the arbiter");
  check(refused(deploy({ USDC_ADDRESS: eurc }), "calls itself EURC"), "a token that isn't what its address is said to be");
  check(refused(deploy({ USDC_ADDRESS: signer(32) }), "has no contract"), "a token with no contract");
  check(refused(deploy({ MOCK_USDC: "1" }), "MOCK_USDC") && refused(deploy({ USDC_VAULT_ADDRESS: usdc }), "never sets a vault"), "mock tokens and a yield vault");
  check(refused(deploy({ REVIEW_PERIOD_DAYS: "" }), "REVIEW_PERIOD_DAYS") && refused(deploy({ EURC_MIN_FEE: "" }), "EURC_MIN_FEE"), "limits that were left unnamed");
  check(refused(deploy({ EXECUTE: "1" }), "CONFIRM_CHAIN_ID"), "sending without typing the chain id in");

  console.log("\nThe deploy script, when everything is right");
  const dry = deploy();
  check(dry.code === 0 && /DRY RUN/.test(dry.text) && /Nothing was sent/.test(dry.text) && !existsSync(join(dir, "deployments", "localhost.json")), "it checks and prints, and sends nothing");
  check(/owner +0x[0-9a-fA-F]{40} +Safe 1\.4\.1, 2 of 3/.test(dry.text) && /holds no role/.test(dry.text) && /treasury is a plain key/.test(dry.text), "it shows the Safes it found and warns about a treasury that is a plain key");

  const sent = deploy({ EXECUTE: "1", CONFIRM_CHAIN_ID: "31337" });
  const file = join(dir, "deployments", "localhost.json");
  check(sent.code === 0 && existsSync(file), "with both confirmations it deploys and records the deployment");
  const record = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const address = record.address;
  const read = (functionName, args = []) => pub.readContract({ address, abi: escrowAbi, functionName, args });
  check(address && (await read("owner")).toLowerCase() === ownerSafe.toLowerCase() && (await read("arbiter")).toLowerCase() === arbiterSafe.toLowerCase() && (await read("treasury")).toLowerCase() === treasury.toLowerCase() && Number(await read("reviewPeriod")) === 3 * 86400, "on-chain, the owner, arbiter, treasury and review period are what was asked");
  check(record.deployer?.toLowerCase() === deployer.address.toLowerCase() && record.owner?.toLowerCase() === ownerSafe.toLowerCase() && record.code?.runtimeCodeHash?.startsWith("0x"), "the record names the deployer, the owner and the hash of the code");
  check((await read("pendingOwner")) === "0x0000000000000000000000000000000000000000" && !(await read("paused")) && !(await read("tokenConfig", [usdc]))[0] && !(await read("tokenConfig", [eurc]))[0], "nothing is switched on: no token, no handover, not paused");
  check(refused(deploy({ EXECUTE: "1", CONFIRM_CHAIN_ID: "31337" }), "already has a deployment") || /deployment recorded/.test(deploy().text), "a second deployment on the same network is refused");

  console.log("\nSwitching the tokens on, and checking the result");
  const check_ = (extra = {}) => run("scripts/check-deployment.cjs", extra);
  const early = check_();
  check(early.code === 0 && /waiting +USDC is not switched on yet/.test(early.text) && /ok +owner/.test(early.text), "before the owner has switched the tokens on, the check says it is waiting and finds nothing wrong");
  check(check_({ REQUIRE_CONFIGURED: "1" }).code === 2, "and with REQUIRE_CONFIGURED=1 it isn't ready");
  const batch = JSON.parse(readFileSync(join(dir, "deployments", "localhost.safe-config.json"), "utf8"));
  check(batch.chainId === "31337" && batch.transactions.length === 2 && batch.transactions.every((t) => t.to.toLowerCase() === address.toLowerCase() && t.data.startsWith("0x")), "a batch for the Safe was written, one call for each token");
  const safeAbi = parseAbi(["function exec(address to, bytes data) returns (bytes)"]);
  const asSafe = async (data) => pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: ownerSafe, abi: safeAbi, functionName: "exec", args: [address, data] }) });
  for (const t of batch.transactions) await asSafe(t.data);
  const done = check_({ REQUIRE_CONFIGURED: "1" });
  check(done.code === 0 && /Everything matches/.test(done.text) && /ok +USDC smallest job/.test(done.text), "once the Safe has run the batch, everything matches");
  check((await read("tokenConfig", [usdc]))[2] === units("43") && (await read("tokenConfig", [usdc]))[3] === units("2174") && (await read("tokenConfig", [usdc]))[4] === "0x0000000000000000000000000000000000000000", "the limits on-chain are the ones that were named, and there is no vault");

  console.log("\nThe check notices when something changes");
  const call = (functionName, args) => asSafe(encodeFunctionData({ abi: escrowAbi, functionName, args }));
  await call("setPaused", [true]);
  const paused = check_({ REQUIRE_CONFIGURED: "1" });
  check(paused.code === 2 && /waiting +the escrow is paused/.test(paused.text), "a paused escrow is reported");
  await call("setPaused", [false]);
  await call("configureToken", [usdc, { enabled: true, surchargeBps: 25, minFee: units("1"), minJob: units("20"), vault: "0x0000000000000000000000000000000000000000" }]);
  const changed = check_();
  check(changed.code === 1 && /WRONG +USDC smallest fee/.test(changed.text), "limits that were changed afterwards are caught");
  await call("configureToken", [usdc, { enabled: true, surchargeBps: 25, minFee: units("43"), minJob: units("2174"), vault: "0x0000000000000000000000000000000000000000" }]);
  check(check_().code === 0, "and the check is quiet again when they are put back");
  await call("transferOwnership", [signer(40)]);
  const handover = check_();
  check(handover.code === 1 && /WRONG +ownership is being handed to/.test(handover.text), "a handover of the ownership that nobody planned is caught");
} catch (e) {
  failures++;
  console.error("\nTest run aborted:", e.message);
} finally {
  stop();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
