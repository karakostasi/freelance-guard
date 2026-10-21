import { randomUUID } from "node:crypto";
import { encodeFunctionData, parseEther, parseUnits } from "viem";
import { db, save } from "./db.mjs";
import { abi, client, ESCROW_ADDRESS, txInfo } from "./chain.mjs";
import * as providers from "./providers.mjs";

const subscribers = new Map();

export function subscribe(runId, fn) {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId).add(fn);
  return () => subscribers.get(runId)?.delete(fn);
}

/** Append an event to the run's history and push it to every open stream. */
export function emit(run, ev) {
  const event = { seq: run.events.length, at: Date.now(), ...ev };
  run.events.push(event);
  save();
  for (const fn of subscribers.get(run.id) ?? []) fn(event);
  return event;
}

async function step(run, stage, id, fn) {
  emit(run, { type: "step_start", stage, step: id });
  const payload = await fn();
  emit(run, { type: "step_done", stage, step: id, payload });
  return payload;
}

function ledger(run, debit, credit, note) {
  const entry = { id: randomUUID().slice(0, 8), runId: run.id, debit, credit, amountEur: run.amountEur, note, at: new Date().toISOString() };
  db.ledger.push(entry);
  save();
  return entry;
}

const fail = (run, e) => {
  run.status = "failed";
  emit(run, { type: "error", message: e.message ?? String(e) });
};

/** What the escrow call needs for a run: the token address (zero for ETH) and the exact amount in base units. */
export function assetOf(run) {
  if (run.token === "eurc") {
    const t = providers.TOKENS.eurc;
    return { address: t.address, symbol: t.symbol, decimals: t.decimals, units: parseUnits(run.amount, t.decimals) };
  }
  return { address: ZERO, symbol: "ETH", decimals: 18, units: parseEther(run.amount) };
}

const ZERO = "0x0000000000000000000000000000000000000000";

export function createRun({ payer, freelancer, amount, token, days, description, route }) {
  const id = randomUUID().slice(0, 8);
  const kind = token === "eurc" ? "eurc" : "eth";
  const run = {
    id,
    ref: `FG-${id.toUpperCase()}`,
    contract: ESCROW_ADDRESS,
    payer,
    freelancer,
    token: kind,
    amount: String(amount),
    amountEur: Math.round(Number(amount) * (kind === "eth" ? providers.EUR_PER_ETH : 1) * 100) / 100,
    days: Number(days),
    description: description ?? "",
    route: route === "eurc" ? "eurc" : "sepa",
    status: "awaiting_bank",
    jobId: null,
    createdAt: Date.now(),
    events: [],
  };
  db.runs[id] = run;
  emit(run, { type: "start" });
  return run;
}

export const publicRun = ({ events: _events, tx: _tx, approval: _approval, ...run }) => run;

/** The bank says the euros arrived (signature already verified by the caller). */
export function bankReceived(run, { amountEur }) {
  if (run.status !== "awaiting_bank") throw new Error(`Payment is ${run.status}, not waiting for a bank transfer`);
  if (Number(amountEur) + 0.005 < run.amountEur) throw new Error(`Received ${amountEur} EUR, expected ${run.amountEur} EUR`);
  run.status = "processing";
  save();

  (async () => {
    await step(run, "inbound", "webhook", async () => ({
      source: "sandbox",
      event: "sepa_instant.credited",
      reference: run.ref,
      amountEur,
      signatureVerified: true,
    }));
    await step(run, "inbound", "aml", () => providers.aml.screen({ payer: run.payer, amountEur }));
    await step(run, "inbound", "ledger", async () => {
      const entry = ledger(run, "client_vIBAN", "escrow_pending", "SEPA credit allocated");
      return { source: "backend", ledgerEntry: entry.id, debit: entry.debit, credit: entry.credit, amountEur };
    });

    await step(run, "tokenization", "fx", () => providers.fx.lock({ amountEur, token: run.token }));
    await step(run, "tokenization", "por", () => providers.reserves.check());
    await step(run, "tokenization", "mint", async () => {
      const result = await providers.mint.mint({ amountEur, token: run.token });
      ledger(run, "escrow_pending", "tokenized", "Converted for escrow");
      return result;
    });

    // The server builds the exact call the user's wallet has to sign.
    const deadline = Math.floor(Date.now() / 1000) + run.days * 86400;
    const asset = assetOf(run);
    const isToken = asset.address !== ZERO;
    const data = isToken
      ? encodeFunctionData({ abi, functionName: "createTokenJob", args: [run.freelancer, BigInt(deadline), run.description, asset.address, asset.units] })
      : encodeFunctionData({ abi, functionName: "createJob", args: [run.freelancer, BigInt(deadline), run.description] });
    run.tx = { to: ESCROW_ADDRESS, data, value: isToken ? "0" : asset.units.toString() };
    // A token job needs the escrow to be allowed to pull the tokens first.
    run.approval = isToken
      ? {
          to: asset.address,
          data: encodeFunctionData({ abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [ESCROW_ADDRESS, asset.units] }),
        }
      : null;
    await step(run, "escrow", "userop", async () => ({
      source: "backend",
      to: ESCROW_ADDRESS,
      function: isToken ? "approve + createTokenJob" : "createJob",
      callData: data,
      asset: asset.symbol,
      amountUnits: asset.units.toString(),
      deadline: new Date(deadline * 1000).toISOString(),
    }));

    run.status = "awaiting_deposit";
    emit(run, { type: "action_required", action: "sign", tx: run.tx, ...(run.approval ? { approval: run.approval } : {}) });
    emit(run, { type: "step_start", stage: "escrow", step: "signature" });
  })().catch((e) => fail(run, e));
}

const byStatus = (status, match = () => true) =>
  Object.values(db.runs)
    .filter((r) => onThisContract(r) && r.status === status && match(r))
    .sort((a, b) => a.createdAt - b.createdAt)[0];

// Job ids restart at 1 on every contract, so a run only belongs to the contract it was created for.
export const onThisContract = (r) => r.contract?.toLowerCase() === ESCROW_ADDRESS?.toLowerCase();

const byJob = (jobId) => Object.values(db.runs).find((r) => onThisContract(r) && r.jobId === Number(jobId));

async function notify(run, event) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  const record = { runId: run.id, event, jobId: run.jobId, freelancer: run.freelancer, at: new Date().toISOString(), delivered: false, target: url ?? "log" };
  if (url) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record), signal: AbortSignal.timeout(5000) });
      record.delivered = res.ok;
      record.status = res.status;
    } catch (e) {
      record.error = e.message;
    }
  } else {
    console.log("[notify]", event, `job ${run.jobId}`);
    record.delivered = true;
  }
  db.notifications.push(record);
  save();
  return record;
}

/** Called for every escrow event the chain watcher sees. */
export async function onChainEvent(log) {
  const { eventName, args } = log;
  const info = () => txInfo(log.transactionHash, log.blockNumber);

  if (eventName === "JobCreated") {
    const run = byStatus("awaiting_deposit", (r) => {
      const asset = assetOf(r);
      return (
        r.payer.toLowerCase() === args.client.toLowerCase() &&
        r.freelancer.toLowerCase() === args.freelancer.toLowerCase() &&
        asset.address.toLowerCase() === args.token.toLowerCase() &&
        asset.units === args.amount
      );
    });
    if (!run) return;
    run.jobId = Number(args.id);
    run.status = "processing";
    const tx = await info();
    emit(run, {
      type: "step_done",
      stage: "escrow",
      step: "signature",
      payload: { source: "chain", signer: args.client, txHash: log.transactionHash, gasMode: run.gasMode ?? "wallet", note: run.gasMode === "sponsored" ? "Gas sponsored by a paymaster." : "Gas paid by the signing wallet." },
    });
    await step(run, "escrow", "deposit", async () => ({
      ...tx,
      function: run.token === "eth" ? "createJob" : "createTokenJob",
      jobId: run.jobId,
      asset: assetOf(run).symbol,
      amountUnits: args.amount.toString(),
    }));

    await step(run, "activated", "funded", async () => {
      const job = await client.readContract({ address: ESCROW_ADDRESS, abi, functionName: "jobs", args: [args.id] });
      return { source: "chain", contract: ESCROW_ADDRESS, jobId: run.jobId, status: ["NONE", "FUNDED", "SUBMITTED", "DISPUTED", "PAID", "REFUNDED"][job[5]] };
    });
    await step(run, "activated", "notify", async () => ({ source: "backend", ...(await notify(run, "job.funded")) }));
    await step(run, "activated", "dashboard", async () => {
      ledger(run, "tokenized", "escrow_locked", "Escrow funded on-chain");
      return { source: "backend", invoice: `INV-${run.jobId}`, status: "FUNDED" };
    });
    run.status = "funded";
    save();
    return;
  }

  const run = byJob(args.id);
  if (!run) return;

  if (eventName === "WorkSubmitted" && run.status === "funded") {
    run.status = "work";
    const tx = await info();
    emit(run, { type: "step_done", stage: "work", step: "submitted", payload: { ...tx, function: "submitWork", deliverable: args.deliverable } });
    emit(run, { type: "step_start", stage: "work", step: "review" });
    await notify(run, "work.submitted");
    return;
  }

  const paid = eventName === "Approved" || (eventName === "Resolved" && args.paidFreelancer);
  if (paid && run.status !== "released" && run.status !== "paid_out") {
    run.status = "released";
    const tx = await info();
    const decidedBy = eventName === "Resolved" ? "arbiter" : "client approval or review timeout";
    emit(run, { type: "step_done", stage: "work", step: "review", payload: { source: "chain", jobId: run.jobId, outcome: eventName === "Resolved" ? "resolved by arbiter" : "approved by client or review timeout" } });
    emit(run, { type: "step_done", stage: "release", step: "approval", payload: { source: "chain", jobId: run.jobId, event: eventName, paidTo: run.freelancer, decidedBy } });
    await step(run, "release", "release", async () => ({ ...tx, function: eventName === "Resolved" ? "resolve" : "approve / claimAfterTimeout", jobId: run.jobId }));

    // Payout routing runs by itself once the escrow has released the funds.
    await step(run, "routing", "route", async () => ({ source: "sandbox", route: run.route, fee: run.route === "eurc" ? "0.00" : "0.15" }));
    await step(run, "routing", "convert", async () => {
      ledger(run, "escrow_locked", "payout_pending", `Payout via ${run.route}`);
      return { source: "sandbox", amountEur: run.amountEur, from: "escrow_locked", to: "payout_pending" };
    });
    await step(run, "settlement", "settle", () => providers.offramp.send({ route: run.route, amountEur: run.amountEur }));
    await step(run, "settlement", "receipt", async () => {
      ledger(run, "payout_pending", "paid_out", "Payout settled");
      return { source: "backend", invoice: `INV-${run.jobId}`, status: "PAID_OUT" };
    });
    run.status = "paid_out";
    emit(run, { type: "done" });
    await notify(run, "payout.settled");
    return;
  }

  if (eventName === "Refunded") {
    run.status = "refunded";
    emit(run, { type: "done" });
    await notify(run, "job.refunded");
  }
}

export { fail };
