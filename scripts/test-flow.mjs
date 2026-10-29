// End-to-end test of the payment flow. It starts its own throwaway chain and backend (so it never touches
// your dev servers), deploys the escrow and a mock EURC, and then drives real payments through the HTTP API
// and the contract, the way the frontend does. Run it with: npm run test:flow
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createPublicClient, createWalletClient, http, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { signInMessage } from "../server/auth.mjs";

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
    const usdc = deployed.match(/Mock USDC deployed to (0x[0-9a-fA-F]{40})/)?.[1];
    const vault = deployed.match(/Mock USDC vault deployed to (0x[0-9a-fA-F]{40})/)?.[1];
    if (!escrow || !eurc || !usdc || !vault) throw new Error(`Could not read the deployed addresses from:\n${deployed}`);

    launch("backend", "node", ["server/index.mjs"], {
      PORT: API_PORT,
      RPC_URL: RPC,
      ESCROW_ADDRESS: escrow,
      EURC_ADDRESS: eurc,
      USDC_ADDRESS: usdc,
      // The first Hardhat account may create the mock tokens, which stands in for an on-ramp that delivers them.
      MINT_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      DB_FILE: join(dir, "db.json"),
      FILES_DIR: join(dir, "files"),
      UPLOADS_PER_DAY: "8", // small, so the quota can be tested
      DATABASE_URL: "", // always the file store, even if a developer's .env points at Postgres
      NOTIFY_WEBHOOK_URL: "",
      WEBHOOK_SECRET: "test-secret",
    });
    await until(async () => (await fetch(`${API}/api/health`)).ok, "the backend");

    await run({ escrow, eurc, usdc, vault });
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

async function run({ escrow, eurc, usdc, vault }) {
  const erc20 = [
    { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  ];
  // Hardhat's well-known test accounts: #0 is the payer, #1 the payee.
  const payer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const payee = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const chain = { chain: hardhat, transport: http(RPC) };
  const pub = createPublicClient(chain);
  const asPayer = createWalletClient({ account: payer, ...chain });
  const asPayee = createWalletClient({ account: payee, ...chain });
  const verifier = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"); // #2
  const asVerifier = createWalletClient({ account: verifier, ...chain });
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
  const base = { payer: payer.address, payee: payee.address, description: "flow test" };
  // The payee signs in and says how they want to be paid. A payment waits for that when the escrow releases the money.
  const signIn = async (account) => {
    const issuedAt = new Date().toISOString();
    const signature = await account.signMessage({ message: signInMessage(account.address, issuedAt) });
    const res = await fetch(`${API}/api/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account.address, issuedAt, signature }) });
    return (await res.json()).token;
  };
  const payeeToken = await signIn(payee);
  const putPayout = (token, body) => fetch(`${API}/api/payout`, { method: "PUT", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

  console.log("\nRequest checks");
  const badHook = await fetch(`${API}/webhooks/bank`, { method: "POST", headers: { "content-type": "application/json", "x-signature": "00" }, body: "{}" });
  check(badHook.status === 401, "a bank webhook with a bad signature is rejected (401)");
  check((await post("/api/payments", { payer: "nope" })).status === 400, "an invalid payment is rejected (400)");
  const legacy = await post("/api/payments", { payer: payer.address, freelancer: payer.address, amount: "1", milestones: [{ title: "a", amount: "1", days: 1 }] });
  check(legacy.status === 400 && legacy.body.error ==="payee must differ from payer", "the old `freelancer` field is still read as the payee");
  const bad = (extra) => post("/api/payments", { ...base, amount: "1000", token: "eurc", route: "eurc", ...extra });
  check((await bad({ milestones: [{ title: "a", amount: "400", days: 3 }, { title: "b", amount: "500", days: 5 }] })).status === 400, "milestones that don't add up to the total are rejected");
  check((await bad({ milestones: [] })).status === 400, "an empty milestone list is rejected");
  check((await bad({ milestones: [{ title: "a", amount: "1000", days: 0 }] })).status === 400, "a milestone with zero days is rejected");
  check((await bad({ milestones: [{ title: "a", amount: "abc", days: 3 }] })).status === 400, "a garbage amount is rejected");
  check((await post("/api/payments", { ...base, amount: "1", token: "dai", milestones: [{ title: "a", amount: "1", days: 1 }] })).status === 400, "an unknown token is rejected");
  const small = await bad({ amount: "10", milestones: [{ title: "a", amount: "10", days: 3 }] });
  check(small.status === 400 && /minimum/.test(small.body.error), "a job below the escrow's minimum is rejected, with the reason");

  console.log("\nFile uploads");
  {
    const send = (path, init) => fetch(API + path, init);
    const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const login = async (account = payer, issuedAt = new Date().toISOString()) => {
      const signature = await account.signMessage({ message: signInMessage(account.address, issuedAt) });
      return send("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account.address, issuedAt, signature }) });
    };
    const put = (token, bytes, name, type = "application/octet-stream") =>
      send("/api/files", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": type, "x-file-name": encodeURIComponent(name) }, body: bytes });

    check((await send("/api/files", { method: "POST", body: "x" })).status === 401, "uploading without signing in is refused (401)");
    check((await send("/api/files", { method: "POST", headers: { authorization: "Bearer nope" }, body: "x" })).status === 401, "a made-up token is refused (401)");
    const wrongSigner = await send("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: payer.address, issuedAt: new Date().toISOString(), signature: await payee.signMessage({ message: "hi" }) }) });
    check(wrongSigner.status === 401, "signing in with a signature from another wallet is refused (401)");
    check((await login(payer, new Date(Date.now() - 3_600_000).toISOString())).status === 401, "an hour-old sign-in message is refused (401)");

    const { token } = await (await login()).json();
    const bytes = Buffer.from("the delivered draft, version 1");
    const created = await put(token, bytes, "draft v1.pdf", "application/pdf");
    const info = await created.json();
    check(created.status === 201 && info.sha256 === sha(bytes) && info.size === bytes.length, "an upload is stored and its SHA-256 comes back");
    check((await put(token, bytes, "again.pdf", "application/pdf")).status === 200, "the same bytes again are recognised, not stored twice");

    const got = await send(`/api/files/${info.sha256}`);
    check(got.status === 200 && Buffer.from(await got.arrayBuffer()).equals(bytes), "the file downloads with the same bytes");
    check(got.headers.get("x-content-type-options") === "nosniff" && got.headers.get("content-security-policy")?.includes("sandbox"), "downloads carry nosniff and a sandbox policy");
    check(got.headers.get("content-type") === "application/pdf" && got.headers.get("content-disposition")?.startsWith("inline"), "a PDF is shown in the browser");
    check(got.headers.get("content-disposition")?.includes("draft%20v1.pdf"), "the file name is kept");

    const page = Buffer.from("<script>alert(1)</script>");
    const html = await (await put(token, page, "page.html", "text/html")).json();
    const served = await send(`/api/files/${html.sha256}`);
    check(served.headers.get("content-type") === "application/octet-stream" && served.headers.get("content-disposition")?.startsWith("attachment"), "an HTML upload is only ever offered as a download, never shown");
    const renamed = await send(`/api/files/${info.sha256}?name=${encodeURIComponent("../../etc/passwd")}`);
    check(!renamed.headers.get("content-disposition")?.includes("%2F") && !renamed.headers.get("content-disposition")?.includes(".."), "a path in the requested name is neutralised") ;

    check((await send(`/api/files/${"0".repeat(64)}`)).status === 404, "an unknown file is a 404");
    check((await send("/api/files/not-a-hash")).status === 404, "a path that isn't a hash is a 404");
    check((await put(token, Buffer.alloc(0), "empty")).status === 400, "an empty file is refused (400)");
    check((await put(token, Buffer.alloc(10 * 1024 * 1024 + 1, 1), "huge")).status === 413, "a file over 10 MB is refused (413)");

    let limited = 0;
    for (let i = 0; i < 12 && !limited; i++) if ((await put(token, Buffer.from(`filler ${i}`), `f${i}`)).status === 429) limited = i + 1;
    check(limited > 0, `the daily upload limit stops further uploads (hit after ${limited} more)`);
    const other = await (await login(payee)).json();
    check((await put(other.token, Buffer.from("someone else's file"), "theirs")).status === 201, "another wallet has its own quota");
  }

  console.log("\nETH payment, one milestone");
  {
    const { body } = await post("/api/payments", { ...base, amount: "0.01", token: "eth", route: "sepa", milestones: [{ title: "Whole job", amount: "0.01", days: 7 }] });
    // The payer also pays a 0.25% surcharge: 0.01 ETH is 25 EUR, so the bank transfer is 25.06.
    check(body.run.amountEur === 25 && body.bank.amountEur === 25.06 && body.run.surcharge === "0.000025", "the bank transfer covers the job and the escrow's surcharge");
    const stream = follow(body.run.id);
    await post("/api/sandbox/bank-transfer", { reference: body.run.ref });
    const action = await until(() => stream.events.find((e) => e.type === "action_required"), "the call to sign");
    check(!action.approval && action.tx.value === parseEther("0.010025").toString(), "an ETH job needs no approval and carries the amount plus the surcharge");
    await mined(await asPayer.sendTransaction({ to: action.tx.to, data: action.tx.data, value: BigInt(action.tx.value) }));
    await until(() => stepDone(stream.events, "activated", "dashboard"), "the job to be funded");
    await mined(await asPayee.writeContract({ address: escrow, abi, functionName: "submitWork", args: [1n, 0n, "https://example.com/work"] }));
    await mined(await asPayer.writeContract({ address: escrow, abi, functionName: "approve", args: [1n, 0n] }));
    // The payee hasn't said how they want to be paid, so the payout waits for them instead of picking a route.
    await until(async () => (await (await fetch(`${API}/api/payments/${body.run.id}`)).json()).status === "awaiting_payout", "the payout to wait for the payee");
    const waiting = await (await fetch(`${API}/api/payments/${body.run.id}`)).json();
    check(waiting.payout?.route === null && !stream.events.some((e) => e.type === "done" || e.stage === "settlement"), "without a choice from the payee nothing is sent anywhere: the payout waits");
    check((await putPayout(payeeToken, { route: "sepa", holder: "Ana Ferreira", iban: "DE89 3704 0044 0532 0130 00" })).status === 200, "the payee chooses a bank account in euros");
    await until(() => stream.events.find((e) => e.type === "done"), "the payout to finish");
    const finalRun = await (await fetch(`${API}/api/payments/${body.run.id}`)).json();
    check(finalRun.status === "paid_out" && finalRun.payout.route === "sepa" && finalRun.payout.chosenBy === "payee", "the payout goes ahead when they choose, and ends as paid out");
    // The fee is 0.0004 ETH (1 EUR, more than 0.25% of this small job), so the payee gets 24 of the 25 EUR.
    check(finalRun.payoutEur === 24 && finalRun.feeEur === 1, "the payout is the job amount less the platform fee");
    check(stream.events.filter((e) => e.type === "step_done").length === 20, "all 20 steps ran");
    check(stream.events.every((e, i) => e.seq === i), "the event stream has no gaps or repeats");
    await stream.stop();
  }

  console.log("\nEURC payment, three milestones (30 / 40 / 30)");
  {
    const eurcBefore = await pub.readContract({ address: eurc, abi: erc20, functionName: "balanceOf", args: [payer.address] });
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
    check(body.bank.amountEur === 1002.5 && body.run.surcharge === "2.5" && body.run.fee === "2.5", "the bank transfer is 1002.50: the job plus a 0.25% surcharge, and the payee's fee is 2.50");
    const stream = follow(body.run.id);
    await post("/api/sandbox/bank-transfer", { reference: body.run.ref });
    const action = await until(() => stream.events.find((e) => e.type === "action_required"), "the calls to sign");
    check(action.approval?.to.toLowerCase() === eurc.toLowerCase() && action.tx.value === "0", "the token is approved first, and no ETH is sent");
    const minted = stepDone(stream.events, "tokenization", "mint")?.payload;
    check(minted?.delivered === true && minted.asset === "EURC" && minted.txHash, "the euros arrive in the payer's wallet as EURC, with the transaction that created them");
    check((await pub.readContract({ address: eurc, abi: erc20, functionName: "balanceOf", args: [payer.address] })) - eurcBefore === parseUnits("1002.5", 6), "the payer got exactly the EURC they have to deposit (the job plus the surcharge)");
    await mined(await asPayer.sendTransaction({ to: action.approval.to, data: action.approval.data }));
    await mined(await asPayer.sendTransaction({ to: action.tx.to, data: action.tx.data }));
    await until(() => stepDone(stream.events, "activated", "dashboard"), "the job to be funded");

    const [, milestones] = await pub.readContract({ address: escrow, abi, functionName: "getJob", args: [2n] });
    check(milestones.length === 3 && milestones.every((m) => m.status === 1), "all three milestones are funded on-chain");
    check(milestones.map((m) => m.title).join() === "Upfront,Draft,Delivery" && milestones[1].amount === parseUnits("400", 6), "titles and amounts match the plan");
    check((await pub.readContract({ address: eurc, abi: erc20, functionName: "balanceOf", args: [escrow] })) === parseUnits("1002.5", 6), "the escrow holds the 1000 EURC and the 2.5 surcharge");
    const linked = await (await fetch(`${API}/api/jobs/2/run`)).json();
    check(linked.status === "funded" && linked.token === "eurc", "the payment is linked to its job");

    // A later milestone is delivered and paid first: the live steps follow the first milestone only.
    await mined(await asPayee.writeContract({ address: escrow, abi, functionName: "submitWork", args: [2n, 1n, "ipfs://draft"] }));
    const approvedAt = (await mined(await asPayer.writeContract({ address: escrow, abi, functionName: "approve", args: [2n, 1n] }))).blockNumber;
    // Wait until the backend has really processed that block, so "nothing happened" can't be a false pass.
    await until(async () => BigInt((await (await fetch(`${API}/api/health`)).json()).processedBlock ?? 0) >= approvedAt, "the backend to process the approval");
    check(!stream.events.some((e) => e.stage === "work"), "events of other milestones don't move the first milestone's steps");

    // This payee keeps the stablecoin, and says so before the release.
    check((await putPayout(payeeToken, { route: "eurc" })).status === 200, "the payee chooses to keep the stablecoin");
    await mined(await asPayee.writeContract({ address: escrow, abi, functionName: "submitWork", args: [2n, 0n, "ipfs://upfront"] }));
    await mined(await asPayer.writeContract({ address: escrow, abi, functionName: "approve", args: [2n, 0n] }));
    await until(() => stream.events.find((e) => e.type === "done"), "the first milestone's payout");
    const received = await pub.readContract({ address: eurc, abi: erc20, functionName: "balanceOf", args: [payee.address] });
    check(received === parseUnits("698.25", 6), "the payee holds 700 EURC less their share of the fee (1.00 and 0.75) from the two paid milestones");
    const done = await (await fetch(`${API}/api/payments/${body.run.id}`)).json();
    check(done.payoutEur === 299.25, "the payout of the first milestone is 300 less its 0.75 fee");
    check(stepDone(stream.events, "settlement", "settle")?.payload.rail === "base", "the payout was routed as EURC");
    await stream.stop();
  }

  // The payee decides where the money goes: a choice made before the release is used at once.
  console.log("\nThe payee chooses how to be paid");
  {
    const us = { route: "ach", holder: "Ana Ferreira", routing: "021000021", account: "12345678" };
    // A browser asks first, and a PUT the server doesn't list is refused before it is sent.
    const preflight = await fetch(`${API}/api/payout`, { method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type" } });
    check(preflight.headers.get("access-control-allow-methods")?.includes("PUT"), "a browser is allowed to save the choice (the CORS preflight lists PUT)");
    check((await putPayout(undefined, us)).status === 401, "choosing how to be paid needs a sign-in");
    check((await putPayout(payeeToken, { route: "sepa", holder: "Ana", iban: "DE00 3704 0044 0532 0130 00" })).status === 400, "an IBAN with a wrong check number is refused");
    check((await putPayout(payeeToken, { ...us, routing: "021000022" })).status === 400, "a routing number that fails the check is refused");
    check((await putPayout(payeeToken, us)).status === 200, "a valid US account is saved");
    const shown = await (await fetch(`${API}/api/payout/${payee.address}`)).json();
    check(shown.route === "ach" && shown.currency === "USD" && shown.last4 === "5678" && !JSON.stringify(shown).includes("12345678"), "anyone can see how the payee is paid, but only the last four digits of the account");
    check((await (await fetch(`${API}/api/payout`, { headers: { authorization: `Bearer ${payeeToken}` } })).json()).account === "12345678", "only the payee can read the account in full");

    // The choice is made before the release, so the payment needs no waiting.
    const { body } = await post("/api/payments", { ...base, amount: "0.01", token: "eth", milestones: [{ title: "Whole job", amount: "0.01", days: 7 }] });
    const stream = follow(body.run.id);
    await post("/api/sandbox/bank-transfer", { reference: body.run.ref });
    const action = await until(() => stream.events.find((e) => e.type === "action_required"), "the call to sign");
    await mined(await asPayer.sendTransaction({ to: action.tx.to, data: action.tx.data, value: BigInt(action.tx.value) }));
    await until(() => stepDone(stream.events, "activated", "dashboard"), "the job to be funded");
    const id = await pub.readContract({ address: escrow, abi, functionName: "jobCount" });
    await mined(await asPayee.writeContract({ address: escrow, abi, functionName: "submitWork", args: [id, 0n, "https://example.com/work"] }));
    await mined(await asPayer.writeContract({ address: escrow, abi, functionName: "approve", args: [id, 0n] }));
    await until(() => stream.events.find((e) => e.type === "done"), "the payout to finish");
    const settled = stepDone(stream.events, "settlement", "settle")?.payload;
    check(settled?.rail === "ach" && settled.currency === "USD" && settled.amount === 26.09 && settled.account === "…5678", "the payout follows the payee: 26.09 dollars to their US account, not euros");
    const finished = await (await fetch(`${API}/api/payments/${body.run.id}`)).json();
    check(finished.payout?.route === "ach" && finished.payout.chosenBy === "payee", "the payment records that the payee chose");
    await stream.stop();
    check((await fetch(`${API}/api/payout`, { method: "DELETE", headers: { authorization: `Bearer ${payeeToken}` } })).status === 200 && (await (await fetch(`${API}/api/payout/${payee.address}`)).json()).route === null, "the payee can take the choice back");
  }

  // Paying in dollars: the dollars become USDC in the payer's wallet, and the job can take the yield.
  console.log("\nUSDC payment in dollars");
  {
    const usdcBalance = (who) => pub.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [who] });
    const one = { title: "Whole job", amount: "500", days: 7 };
    check((await post("/api/payments", { ...base, amount: "500", token: "eurc", useYield: true, milestones: [one] })).status === 400, "yield is refused for euros");
    check((await post("/api/payments", { ...base, amount: "500", token: "usdc", useYield: "yes", milestones: [one] })).status === 400, "yield has to be true or false");

    // Without the yield the payer pays a 0.25% surcharge, in dollars.
    const plain = await post("/api/payments", { ...base, amount: "500", token: "usdc", route: "eurc", useYield: false, milestones: [one] });
    check(plain.body.bank?.currency === "USD" && plain.body.bank.amount === 501.25 && plain.body.run.surcharge === "1.25", "without the yield the bank transfer is $501.25: the job and a 1.25 surcharge");

    // With it, there is no surcharge and the money goes to the vault.
    const { body } = await post("/api/payments", { ...base, amount: "500", token: "usdc", route: "eurc", useYield: true, milestones: [one] });
    check(body.bank.currency === "USD" && body.bank.amount === 500 && body.run.surcharge === "0" && body.run.useYield === true, "with the yield the bank transfer is $500 and has no surcharge");
    const before = { payer: await usdcBalance(payer.address), vault: await usdcBalance(vault) };
    const stream = follow(body.run.id);
    await post("/api/sandbox/bank-transfer", { reference: body.run.ref });
    const action = await until(() => stream.events.find((e) => e.type === "action_required"), "the calls to sign");
    const minted = stepDone(stream.events, "tokenization", "mint")?.payload;
    check(minted?.delivered === true && minted.asset === "USDC" && (await usdcBalance(payer.address)) - before.payer === parseUnits("500", 6), "the dollars arrive in the payer's wallet as 500 USDC");
    check(stepDone(stream.events, "inbound", "webhook")?.payload.currency === "USD", "the bank step records dollars");
    await mined(await asPayer.sendTransaction({ to: action.approval.to, data: action.approval.data }));
    await mined(await asPayer.sendTransaction({ to: action.tx.to, data: action.tx.data }));
    await until(() => stepDone(stream.events, "activated", "dashboard"), "the job to be funded");
    const id = await pub.readContract({ address: escrow, abi, functionName: "jobCount" });
    const [head] = await pub.readContract({ address: escrow, abi, functionName: "getJob", args: [id] });
    check(head.yield === true && head.surchargeBps === 0 && (await usdcBalance(vault)) - before.vault === parseUnits("500", 6), "the job took the yield, and its 500 USDC are in the vault");
    await stream.stop();
  }

  // What the frontend does when the payer pays from a wallet: price the job, take the yield, name a verifier.
  console.log("\nWallet job with yield and a verifier (USDC)");
  {
    const usdcBalance = (who) => pub.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [who] });
    const zero = "0x0000000000000000000000000000000000000000";
    await mined(await asPayer.writeContract({ address: usdc, abi: erc20, functionName: "mint", args: [payer.address, parseUnits("5000", 6)] }));
    await mined(await asPayer.writeContract({ address: usdc, abi: erc20, functionName: "approve", args: [escrow, parseUnits("5000", 6)] }));

    const config = await pub.readContract({ address: escrow, abi, functionName: "tokenConfig", args: [usdc] });
    check(config[0] === true && config[4].toLowerCase() === vault.toLowerCase(), "USDC is enabled and has a vault");
    const amounts = [parseUnits("600", 6), parseUnits("400", 6)];
    const [, fee, surcharge] = await pub.readContract({ address: escrow, abi, functionName: "quote", args: [usdc, amounts, false] });
    const [, , yieldSurcharge] = await pub.readContract({ address: escrow, abi, functionName: "quote", args: [usdc, amounts, true] });
    check(fee === parseUnits("2.5", 6) && surcharge === parseUnits("2.5", 6) && yieldSurcharge === 0n, "the quote is a 2.50 fee, and a 2.50 surcharge unless the job takes the yield");

    const items = amounts.map((amount, i) => ({ title: `m${i + 1}`, amount, duration: 86400 * 7 }));
    const before = { payer: await usdcBalance(payer.address), vault: await usdcBalance(vault) };
    await mined(await asPayer.writeContract({ address: escrow, abi, functionName: "createJob", args: [payee.address, usdc, "yield test", items, { verifier: verifier.address, useYield: true, fundNow: true }] }));
    check(before.payer - (await usdcBalance(payer.address)) === parseUnits("1000", 6), "a job that takes the yield costs exactly its amount");
    check((await usdcBalance(vault)) - before.vault === parseUnits("1000", 6), "the money is in the vault");
    const id = await pub.readContract({ address: escrow, abi, functionName: "jobCount" });
    const [head, milestones] = await pub.readContract({ address: escrow, abi, functionName: "getJob", args: [id] });
    check(head.yield && head.surchargeBps === 0 && head.fee === fee && head.total === parseUnits("1000", 6) && head.verifier.toLowerCase() === verifier.address.toLowerCase(), "the job records its yield, fee and verifier");
    check(milestones.every((m) => m.status === 1 && m.epoch === 1), "its milestones are funded and in the vault");

    await mined(await asPayee.writeContract({ address: escrow, abi, functionName: "submitWork", args: [id, 0n, "ipfs://done"] }));
    const rejected = await asPayee.writeContract({ address: escrow, abi, functionName: "approve", args: [id, 0n] }).then(() => false, () => true);
    check(rejected, "the payee can't approve their own work");
    await mined(await asVerifier.writeContract({ address: escrow, abi, functionName: "approve", args: [id, 0n] }));
    check((await usdcBalance(payee.address)) === parseUnits("600", 6) - (parseUnits("2.5", 6) * 600n) / 1000n, "the verifier's approval pays the payee, less the fee share");
    check((await usdcBalance(vault)) - before.vault === parseUnits("400", 6), "the paid milestone left the vault");

    await mined(await asPayee.writeContract({ address: escrow, abi, functionName: "submitWork", args: [id, 1n, "ipfs://done 2"] }));
    await mined(await asPayer.writeContract({ address: escrow, abi, functionName: "setVerifier", args: [id, zero] }));
    const gone = await asVerifier.writeContract({ address: escrow, abi, functionName: "approve", args: [id, 1n] }).then(() => false, () => true);
    check(gone, "after the payer removes the verifier, it can no longer approve");
  }
}

main();
