// Reads a deployed escrow back from the chain and compares it with what was recorded when it was deployed
// (deployments/<network>.json). Run it after the owner has switched the tokens on, and from time to time after that.
// It exits with an error if anything is different. REQUIRE_CONFIGURED=1 also counts "tokens not switched on yet" as one.
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { ethers } = hre;
const { SYMBOLS, ZERO, same } = require("./lib/mainnet-plan.cjs");

async function main() {
  const network = hre.network.name;
  const file = path.resolve(process.env.DEPLOYMENTS_DIR ?? "deployments", `${network}.json`);
  if (!fs.existsSync(file)) {
    console.error(` - No ${file}: nothing was deployed to ${network} from here.`);
    process.exit(1);
  }
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const { chainId } = await ethers.provider.getNetwork();
  if (Number(chainId) !== record.chainId) {
    console.error(` - The RPC is on chain ${chainId}, and the record is for chain ${record.chainId}.`);
    process.exit(1);
  }

  const wrong = [];
  const pending = [];
  const ok = [];
  const want = (what, got, expected) => (same(got, expected) ? ok.push(`${what}: ${got}`) : wrong.push(`${what} is ${got}, and the record says ${expected}`));

  const code = await ethers.provider.getCode(record.address);
  if (code === "0x") {
    console.error(` - There is no contract at ${record.address}.`);
    process.exit(1);
  }
  want("code hash", ethers.keccak256(code), record.code.runtimeCodeHash);

  const escrow = await ethers.getContractAt("FreelanceEscrow", record.address);
  want("owner", await escrow.owner(), record.owner);
  want("arbiter", await escrow.arbiter(), record.arbiter);
  want("treasury", await escrow.treasury(), record.treasury);
  want("review period", String(await escrow.reviewPeriod()), String(record.reviewPeriodSeconds));
  const nextOwner = await escrow.pendingOwner();
  if (!same(nextOwner, ZERO)) wrong.push(`ownership is being handed to ${nextOwner}: nobody asked for that`);
  if (await escrow.paused()) pending.push("the escrow is paused");

  for (const symbol of SYMBOLS) {
    const t = record.tokens[symbol];
    const cfg = await escrow.tokenConfig(t.address);
    if (!cfg.enabled) {
      pending.push(`${symbol} is not switched on yet`);
      continue;
    }
    want(`${symbol} smallest fee`, String(cfg.minFee), t.minFee);
    want(`${symbol} smallest job`, String(cfg.minJob), t.minJob);
    want(`${symbol} surcharge`, String(cfg.surchargeBps), String(record.surchargeBps));
    want(`${symbol} yield vault`, cfg.vault, ZERO);
  }
  // ETH is never offered on a real network: its euro limits would need a price.
  if ((await escrow.tokenConfig(ZERO)).enabled) wrong.push("ETH is switched on, and it is not meant to be");

  console.log(`\n${network}: escrow ${record.address} (deployed in block ${record.blockNumber}, code from commit ${record.code.gitCommit?.slice(0, 10) ?? "?"})`);
  for (const line of ok) console.log(`  ok       ${line}`);
  for (const line of pending) console.log(`  waiting  ${line}`);
  for (const line of wrong) console.log(`  WRONG    ${line}`);
  if (wrong.length > 0) {
    console.error("\nWhat is on-chain is not what was deployed. Don't use it until you know why.");
    process.exit(1);
  }
  if (pending.length > 0 && process.env.REQUIRE_CONFIGURED === "1") {
    console.error("\nNot ready yet.");
    process.exit(2);
  }
  console.log(pending.length > 0 ? "\nNothing is wrong, but it isn't ready yet." : "\nEverything matches.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
