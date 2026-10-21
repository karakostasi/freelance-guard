// End-to-end test of the payment flow. It starts its own throwaway chain and backend (so it never touches
// your dev servers), deploys the escrow and a mock EURC, and then drives real payments through the HTTP API
// and the contract, the way the frontend does. Run it with: npm run test:flow
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const CHAIN_PORT = process.env.TEST_CHAIN_PORT ?? "8645";
const API_PORT = process.env.TEST_API_PORT ?? "8799";
const RPC = `http://127.0.0.1:${CHAIN_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const abi = JSON.parse(readFileSync(new URL("../abi/FreelanceEscrow.json", import.meta.url), "utf8")).abi;

const children = [];
const logs = new Map();
let failures = 0;
const check = (condition, message) => {
  console.log(condition ? "  PASS" : "  FAIL", message);
  if (!condition) failures++;
};

function launch(name, command, args, env = {}) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const buffer = [];
  logs.set(name, buffer);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (d) => buffer.push(String(d)));
  child.on("exit", (code) => buffer.push(`[exited with code ${code}]`));
  children.push(child);
  return child;
}

async function until(fn, what, ms = 30_000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ""}`);
}

function cleanup(dir) {
  for (const child of children) child.kill("SIGTERM");
  if (dir) rmSync(dir, { recursive: true, force: true });
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "fg-flow-"));
  process.on("SIGINT", () => {
    cleanup(dir);
    process.exit(130);
  });

  try {
    console.log("Starting a local chain and deploying…");
    launch("chain", "npx", ["hardhat", "node", "--port", CHAIN_PORT]);
    await until(
      async () => (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).ok,
      "the local chain",
    );
    const deployed = execFileSync("npx", ["hardhat", "run", "scripts/deploy.cjs", "--network", "localhost"], { env: { ...process.env, LOCAL_RPC_URL: RPC } }).toString();
    const escrow = deployed.match(/FreelanceEscrow deployed to (0x[0-9a-fA-F]{40})/)?.[1];
    const eurc = deployed.match(/Mock EURC deployed to (0x[0-9a-fA-F]{40})/)?.[1];
    if (!escrow || !eurc) throw new Error(`Could not read the deployed addresses from:\n${deployed}`);

    launch("backend", "node", ["server/index.mjs"], {
      PORT: API_PORT,
      RPC_URL: RPC,
      ESCROW_ADDRESS: escrow,
      EURC_ADDRESS: eurc,
      DB_FILE: join(dir, "db.json"),
      DATABASE_URL: "", // always the file store, even if a developer's .env points at Postgres
      NOTIFY_WEBHOOK_URL: "",
      WEBHOOK_SECRET: "test-secret",
    });
    await until(async () => (await fetch(`${API}/api/health`)).ok, "the backend");

    await run({ escrow, eurc });
  } catch (e) {
    failures++;
    console.error("\nTest run aborted:", e.message);
    for (const [name, buffer] of logs) console.error(`\n--- ${name} output (last lines) ---\n${buffer.join("").split("\n").slice(-15).join("\n")}`);
  } finally {
    cleanup(dir);
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

async function run({ escrow, eurc }) {
  const erc20 = [
    { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  ];
  // Hardhat's well-known test accounts: #0 is the client, #1 the freelancer.
  const client = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const freelancer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const chain = { chain: hardhat, transport: http(RPC) };
  const pub = createPublicClient(chain);
  const asClient = createWalletClient({ account: client, ...chain });
  const asFreelancer = createWalletClient({ account: freelancer, ...chain });
  const mined = (hash) => pub.waitForTransactionReceipt({ hash });

  const post = async (path, body) => {
    const res = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  // Follows a payment's live event stream, like the browser does.
  function follow(runId) {
    const events = [];
    const abort = new AbortController();
    const finished = fetch(`${API}/api/payments/${runId}/events`, { signal: abort.signal })
      .then(async (res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value);
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const line = buffer.slice(0, end).split("\n").find((l) => l.startsWith("data: "));
            buffer = buffer.slice(end + 2);
            if (line) events.push(JSON.parse(line.slice(6)));
          }
        }
      })
      .catch(() => {});
    return { events, stop: async () => (abort.abort(), finished) };
  }
  const stepDone = (events, stage, step) => events.find((e) => e.type === "step_done" && e.stage === stage && e.step === step);
  const base = { payer: client.address, freelancer: freelancer.address, description: "flow test" };

  console.log("\nRequest checks");
  const badHook = await fetch(`${API}/webhooks/bank`, { method: "POST", headers: { "content-type": "application/json", "x-signature": "00" }, body: "{}" });
  check(badHook.status === 401, "a bank webhook with a bad signature is rejected (401)");
  check((await post("/api/payments", { payer: "nope" })).status === 400, "an invalid payment is rejected (400)");
  const bad = (extra) => post("/api/payments", { ...base, amount: "1000", token: "eurc", route: "eurc", ...extra });
  check((await bad({ milestones: [{ title: "a", amount: "400", days: 3 }, { title: "b", amount: "500", days: 5 }] })).status === 400, "milestones that don't add up to the total are rejected");
  check((await bad({ milestones: [] })).status === 400, "an empty milestone list is rejected");
  check((await bad({ milestones: [{ title: "a", amount: "1000", days: 0 }] })).status === 400, "a milestone with zero days is rejected");
  check((await bad({ milestones: [{ title: "a", amount: "abc", days: 3 }] })).status === 400, "a garbage amount is rejected");
  check((await post("/api/payments", { ...base, amount: "1", token: "dai", milestones: [{ title: "a", amount: "1", days: 1 }] })).status === 400, "an unknown token is rejected");

  console.log("\nETH payment, one milestone");
  {
    const { body } = await post("/api/payments", { ...base, amount: "0.01", token: "eth", route: "sepa", milestones: [{ title: "Whole job", amount: "0.01", days: 7 }] });
    const stream = follow(body.run.id);
    await post("/api/sandbox/bank-transfer", { reference: body.run.ref });
    const action = await until(() => stream.events.find((e) => e.type === "action_required"), "the call to sign");
    check(!action.approval && action.tx.value === parseEther("0.01").toString(), "an ETH job needs no approval and carries the value");
    await mined(await asClient.sendTransaction({ to: action.tx.to, data: action.tx.data, value: BigInt(action.tx.value) }));
    await until(() => stepDone(stream.events, "activated", "dashboard"), "the job to be funded");
    await mined(await asFreelancer.writeContract({ address: escrow, abi, functionName: "submitWork", args: [1n, 0n, "https://example.com/work"] }));
    await mined(await asClient.writeContract({ address: escrow, abi, functionName: "approve", args: [1n, 0n] }));
    await until(() => stream.events.find((e) => e.type === "done"), "the payout to finish");
    const finalRun = await (await fetch(`${API}/api/payments/${body.run.id}`)).json();
    check(finalRun.status === "paid_out", "the payment ends as paid out");
    check(stream.events.filter((e) => e.type === "step_done").length === 20, "all 20 steps ran");
    check(stream.events.every((e, i) => e.seq === i), "the event stream has no gaps or repeats");
    await stream.stop();
  }

  console.log("\nEURC payment, three milestones (30 / 40 / 30)");
  {
    await mined(await asClient.writeContract({ address: eurc, abi: erc20, functionName: "mint", args: [client.address, parseUnits("5000", 6)] }));
    const { body } = await post("/api/payments", {
      ...base,
      amount: "1000",
      token: "eurc",
      route: "eurc",
      milestones: [
        { title: "Upfront", amount: "300", days: 3 },
        { title: "Draft", amount: "400", days: 10 },
        { title: "Delivery", amount: "300", days: 20 },
      ],
    });
    check(body.run?.milestones?.length === 3 && body.run.amountEur === 1000, "a 3-milestone EURC payment is accepted (EUR 1000, 1:1)");
    const stream = follow(body.run.id);
    await post("/api/sandbox/bank-transfer", { reference: body.run.ref });
    const action = await until(() => stream.events.find((e) => e.type === "action_required"), "the calls to sign");
    check(action.approval?.to.toLowerCase() === eurc.toLowerCase() && action.tx.value === "0", "the token is approved first, and no ETH is sent");
    await mined(await asClient.sendTransaction({ to: action.approval.to, data: action.approval.data }));
    await mined(await asClient.sendTransaction({ to: action.tx.to, data: action.tx.data }));
    await until(() => stepDone(stream.events, "activated", "dashboard"), "the job to be funded");

    const [, milestones] = await pub.readContract({ address: escrow, abi, functionName: "getJob", args: [2n] });
    check(milestones.length === 3 && milestones.every((m) => m.status === 1), "all three milestones are funded on-chain");
    check(milestones.map((m) => m.title).join() === "Upfront,Draft,Delivery" && milestones[1].amount === parseUnits("400", 6), "titles and amounts match the plan");
    check((await pub.readContract({ address: eurc, abi: erc20, functionName: "balanceOf", args: [escrow] })) === parseUnits("1000", 6), "the escrow holds the full 1000 EURC");
    const linked = await (await fetch(`${API}/api/jobs/2/run`)).json();
    check(linked.status === "funded" && linked.token === "eurc", "the payment is linked to its job");

    // A later milestone is delivered and paid first: the live steps follow the first milestone only.
    await mined(await asFreelancer.writeContract({ address: escrow, abi, functionName: "submitWork", args: [2n, 1n, "ipfs://draft"] }));
    const approvedAt = (await mined(await asClient.writeContract({ address: escrow, abi, functionName: "approve", args: [2n, 1n] }))).blockNumber;
    // Wait until the backend has really processed that block, so "nothing happened" can't be a false pass.
    await until(async () => BigInt((await (await fetch(`${API}/api/health`)).json()).processedBlock ?? 0) >= approvedAt, "the backend to process the approval");
    check(!stream.events.some((e) => e.stage === "work"), "events of other milestones don't move the first milestone's steps");

    await mined(await asFreelancer.writeContract({ address: escrow, abi, functionName: "submitWork", args: [2n, 0n, "ipfs://upfront"] }));
    await mined(await asClient.writeContract({ address: escrow, abi, functionName: "approve", args: [2n, 0n] }));
    await until(() => stream.events.find((e) => e.type === "done"), "the first milestone's payout");
    const received = await pub.readContract({ address: eurc, abi: erc20, functionName: "balanceOf", args: [freelancer.address] });
    check(received === parseUnits("700", 6), "the freelancer holds 700 EURC from the two paid milestones");
    check(stepDone(stream.events, "settlement", "settle")?.payload.rail === "base", "the payout was routed as EURC");
    await stream.stop();
  }
}

main();
