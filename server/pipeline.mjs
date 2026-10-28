import { randomUUID } from "node:crypto";
import { encodeFunctionData, formatUnits, parseEther, parseUnits } from "viem";
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

function ledger(run, debit, credit, note, amountEur = run.transferEur ?? run.amountEur) {
  const entry = { id: randomUUID().slice(0, 8), runId: run.id, debit, credit, amountEur, note, at: new Date().toISOString() };
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

const eurPer = (kind) => (kind === "eth" ? providers.EUR_PER_ETH : 1);
const toEur = (kind, units, decimals) => Math.round(Number(formatUnits(units, decimals)) * eurPer(kind) * 100) / 100;

/** What the payer sends to the escrow for a run: the job amount plus the surcharge, in base units. */
export const dueUnits = (run) => assetOf(run).units + parseUnits(run.surcharge ?? "0", assetOf(run).decimals);

const REVERTS = {
  JobTooSmall: "This amount is below the minimum job size",
  TokenNotAllowed: "This token is not accepted",
};

/** What the escrow charges for a job, read from the contract so the rules live in one place. */
async function quoteFor(kind, plan) {
  const asset = assetOf({ token: kind, amount: "0" });
  try {
    const [total, fee, surcharge] = await client.readContract({
      address: ESCROW_ADDRESS,
      abi,
      functionName: "quote",
      args: [asset.address, plan.map((m) => unitsFor(kind, m.amount)), false],
    });
    return { total, fee, surcharge, decimals: asset.decimals };
  } catch (e) {
    const name = e.walk?.((x) => x?.data?.errorName)?.data?.errorName;
    if (REVERTS[name]) throw badRequest(REVERTS[name]);
    throw e;
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

const unitsFor = (kind, amount) => (kind === "eurc" ? parseUnits(amount, providers.TOKENS.eurc.decimals) : parseEther(amount));

/**
 * Validates and normalises the milestones of a payment. Without a list, the payment is one milestone.
 * The milestone amounts must add up to the total exactly.
 */
export function milestonePlan({ token, amount, days, milestones }) {
  const kind = token === "eurc" ? "eurc" : "eth";
  const list = milestones ?? [{ title: "Payment", amount, days }];
  if (!Array.isArray(list) || list.length < 1 || list.length > 20) throw badRequest("milestones must have 1 to 20 items");
  let sum = 0n;
  const plan = list.map((m, i) => {
    let units;
    try {
      units = unitsFor(kind, String(m.amount));
    } catch {
      throw badRequest(`milestone ${i + 1}: invalid amount`);
    }
    if (units <= 0n) throw badRequest(`milestone ${i + 1}: amount must be greater than 0`);
    if (!(Number(m.days) > 0)) throw badRequest(`milestone ${i + 1}: days must be greater than 0`);
    sum += units;
    return { title: String(m.title ?? "").trim() || `Milestone ${i + 1}`, amount: String(m.amount), days: Number(m.days) };
  });
  let total;
  try {
    total = unitsFor(kind, String(amount));
  } catch {
    throw badRequest("invalid total amount");
  }
  if (sum !== total) throw badRequest("milestone amounts must add up to the total");
  return plan;
}

export async function createRun({ payer, payee, amount, token, milestones, days, description, route }) {
  const id = randomUUID().slice(0, 8);
  const kind = token === "eurc" ? "eurc" : "eth";
  const plan = milestonePlan({ token, amount, days, milestones });
  const quote = await quoteFor(kind, plan);
  const run = {
    id,
    ref: `SQ-${id.toUpperCase()}`,
    contract: ESCROW_ADDRESS,
    payer,
    payee,
    token: kind,
    amount: String(amount),
    // The job amount is what the payee is owed. The payer also pays the escrow's surcharge, so the bank transfer is
    // `transferEur`. (The payee's fee comes out of what they receive.)
    amountEur: toEur(kind, quote.total, quote.decimals),
    surcharge: formatUnits(quote.surcharge, quote.decimals),
    fee: formatUnits(quote.fee, quote.decimals),
    transferEur: toEur(kind, quote.total + quote.surcharge, quote.decimals),
    milestones: plan,
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
  const expected = run.transferEur ?? run.amountEur;
  if (Number(amountEur) + 0.005 < expected) throw new Error(`Received ${amountEur} EUR, expected ${expected} EUR`);
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
      const entry = ledger(run, "payer_vIBAN", "escrow_pending", "SEPA credit allocated");
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
    // Every milestone is funded right away: a bank transfer is a single payment for the total.
    const items = run.milestones.map((m) => ({ title: m.title, amount: unitsFor(run.token, m.amount), duration: Math.round(m.days * 86400) }));
    const asset = assetOf(run);
    const isToken = asset.address !== ZERO;
    const due = dueUnits(run);
    const options = { verifier: ZERO, useYield: false, fundNow: true };
    const data = encodeFunctionData({ abi, functionName: "createJob", args: [run.payee, asset.address, run.description, items, options] });
    run.tx = { to: ESCROW_ADDRESS, data, value: isToken ? "0" : due.toString() };
    // A token job needs the escrow to be allowed to pull the tokens first.
    run.approval = isToken
      ? {
          to: asset.address,
          data: encodeFunctionData({ abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [ESCROW_ADDRESS, due] }),
        }
      : null;
    await step(run, "escrow", "userop", async () => ({
      source: "backend",
      to: ESCROW_ADDRESS,
      function: isToken ? "approve + createJob" : "createJob",
      callData: data,
      asset: asset.symbol,
      amountUnits: asset.units.toString(),
      surchargeUnits: (due - asset.units).toString(),
      milestones: items.length,
      milestoneTitles: run.milestones.map((m) => m.title),
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
  const record = { runId: run.id, event, jobId: run.jobId, payee: run.payee, at: new Date().toISOString(), delivered: false, target: url ?? "log" };
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
        r.payer.toLowerCase() === args.payer.toLowerCase() &&
        r.payee.toLowerCase() === args.payee.toLowerCase() &&
        asset.address.toLowerCase() === args.token.toLowerCase() &&
        args.milestoneCount === BigInt(r.milestones.length) &&
        asset.units === args.total
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
      payload: { source: "chain", signer: args.payer, txHash: log.transactionHash, gasMode: run.gasMode ?? "wallet", note: run.gasMode === "sponsored" ? "Gas sponsored by a paymaster." : "Gas paid by the signing wallet." },
    });
    await step(run, "escrow", "deposit", async () => ({
      ...tx,
      function: "createJob",
      jobId: run.jobId,
      asset: assetOf(run).symbol,
      amountUnits: args.total.toString(),
      feeUnits: args.fee.toString(),
      surchargeBps: Number(args.surchargeBps),
    }));

    await step(run, "activated", "funded", async () => {
      const [, milestones] = await client.readContract({ address: ESCROW_ADDRESS, abi, functionName: "getJob", args: [args.id] });
      return { source: "chain", contract: ESCROW_ADDRESS, jobId: run.jobId, status: ["UNFUNDED", "FUNDED", "SUBMITTED", "DISPUTED", "PAID", "REFUNDED"][milestones[0].status] };
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
  // Payment runs only ever cover the first (and only) milestone of the job they created.
  if (args.milestone !== undefined && args.milestone !== 0n) return;

  // The escrow says what the payee really gets (the amount less the fee) just before it says the milestone was approved.
  if (eventName === "MilestonePaid") {
    const asset = assetOf(run);
    run.payoutEur = toEur(run.token, args.gross - args.fee, asset.decimals);
    run.feeEur = toEur(run.token, args.fee, asset.decimals);
    save();
    return;
  }

  if (eventName === "WorkSubmitted" && run.status === "funded") {
    run.status = "work";
    const tx = await info();
    emit(run, { type: "step_done", stage: "work", step: "submitted", payload: { ...tx, function: "submitWork", deliverable: args.deliverable } });
    emit(run, { type: "step_start", stage: "work", step: "review" });
    await notify(run, "work.submitted");
    return;
  }

  const paid = eventName === "Approved" || (eventName === "Resolved" && args.paidPayee);
  if (paid && run.status !== "released" && run.status !== "paid_out") {
    run.status = "released";
    const tx = await info();
    const decidedBy = eventName === "Resolved" ? "arbiter" : "payer approval or review timeout";
    emit(run, { type: "step_done", stage: "work", step: "review", payload: { source: "chain", jobId: run.jobId, outcome: eventName === "Resolved" ? "resolved by arbiter" : "approved by payer or review timeout" } });
    emit(run, { type: "step_done", stage: "release", step: "approval", payload: { source: "chain", jobId: run.jobId, event: eventName, paidTo: run.payee, decidedBy } });
    await step(run, "release", "release", async () => ({ ...tx, function: eventName === "Resolved" ? "resolve" : "approve / claimAfterTimeout", jobId: run.jobId }));

    // Payout routing runs by itself once the escrow has released the funds.
    // The payee is paid what is left after the platform fee.
    const payoutEur = run.payoutEur ?? run.amountEur;
    await step(run, "routing", "route", async () => ({ source: "sandbox", route: run.route, fee: run.route === "eurc" ? "0.00" : "0.15" }));
    await step(run, "routing", "convert", async () => {
      ledger(run, "escrow_locked", "payout_pending", `Payout via ${run.route}`, payoutEur);
      return { source: "sandbox", amountEur: payoutEur, from: "escrow_locked", to: "payout_pending" };
    });
    await step(run, "settlement", "settle", () => providers.offramp.send({ route: run.route, amountEur: payoutEur }));
    await step(run, "settlement", "receipt", async () => {
      ledger(run, "payout_pending", "paid_out", "Payout settled", payoutEur);
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
