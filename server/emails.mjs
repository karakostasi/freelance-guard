import { readPayload, signPayload } from "./auth.mjs";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const cleanEmail = (value) => {
  const email = String(value ?? "").trim();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
};

const HOUR = 60 * 60 * 1000;

/** The link in the confirmation email. Only the owner of the inbox can follow it. */
export const confirmToken = (address, email, now = Date.now()) => signPayload({ k: "confirm", addr: address.toLowerCase(), email }, now, 24 * HOUR);
/** The link at the bottom of every notification. Valid for a year. */
export const unsubscribeToken = (address, email, now = Date.now()) => signPayload({ k: "unsub", addr: address.toLowerCase(), email }, now, 365 * 24 * HOUR);

/** The address and email a confirm or unsubscribe token was made for, or null. */
export function readEmailToken(token, kind, now = Date.now()) {
  const p = readPayload(token, now);
  return p && p.k === kind && typeof p.addr === "string" && typeof p.email === "string" ? { address: p.addr, email: p.email } : null;
}

const days = (seconds) => {
  const d = Math.round(Number(seconds) / 86400);
  return d >= 1 ? `${d} day${d === 1 ? "" : "s"}` : "a short time";
};

/**
 * The emails an escrow event calls for: one for each person involved, worded for their side. Empty for events
 * that don't need one. `job` is the job as read from the contract ({ payer, payee }).
 */
export function messagesFor(eventName, args, job, { reviewPeriod, arbiter, appUrl }) {
  const id = Number(args.id);
  const ms = args.milestone === undefined ? "" : ` (milestone ${Number(args.milestone) + 1})`;
  const open = `\n\nOpen the job: ${appUrl}/#/flow/${id}`;
  const note = (to, subject, text) => ({ to, subject, text: text + open });
  const { payer, payee } = job;
  const window = reviewPeriod ? days(reviewPeriod) : "";

  if (eventName === "MilestoneFunded") {
    return [
      note(payee, `Job #${id} has been funded`, `The payer has locked the payment for job #${id}${ms} in escrow, so you can start. Your delivery clock is running.`),
      note(payer, `You funded job #${id}`, `Your payment for job #${id}${ms} is locked in escrow. The payee's delivery clock is running.`),
    ];
  }
  if (eventName === "WorkSubmitted") {
    return [
      note(payer, `Work was submitted for job #${id}`, `The payee has submitted work for job #${id}${ms}.${window ? ` You have ${window} to approve or dispute it. After that the payee can claim the payment.` : ""}`),
      note(payee, `Your work on job #${id} was submitted`, `Your delivery for job #${id}${ms} is with the payer for review.${window ? ` They have ${window} to approve or dispute it, and after that you can claim the payment.` : ""}`),
    ];
  }
  if (eventName === "Approved" || (eventName === "Resolved" && args.paidPayee)) {
    const by = eventName === "Resolved" ? "The arbiter decided in favour of the payee." : "";
    // The page is built by the frontend: "#/receipt/<job>/<milestone>", numbered from 1 (src/lib/documents.ts receiptPath).
    const receipt = `\n\nReceipt: ${appUrl}/#/receipt/${id}/${Number(args.milestone) + 1}`;
    return [
      note(payee, `Payment released for job #${id}`, `The payment for job #${id}${ms} was released to you. ${by}`.trim() + receipt),
      note(payer, `Payment released for job #${id}`, `The payment for job #${id}${ms} was released to the payee. ${by}`.trim() + receipt),
    ];
  }
  if (eventName === "Disputed") {
    return [
      note(payer, `You disputed job #${id}`, `You disputed the work on job #${id}${ms}. The arbiter will decide who gets the funds.`),
      note(payee, `Job #${id} was disputed`, `The payer disputed your work on job #${id}${ms}. The arbiter will decide who gets the funds.`),
      ...(arbiter ? [note(arbiter, `A dispute needs your decision on job #${id}`, `The payer disputed the work on job #${id}${ms}. Please resolve it.`)] : []),
    ];
  }
  // A refund by the arbiter emits Refunded as well as Resolved, so Refunded is the one that tells people.
  if (eventName === "Refunded") {
    return [
      note(payer, `Job #${id} was refunded to you`, `The payment for job #${id}${ms} was returned to you.`),
      note(payee, `Job #${id} was refunded to the payer`, `The payment for job #${id}${ms} was returned to the payer.`),
    ];
  }
  return [];
}

export const NOTIFIED = new Set(["MilestoneFunded", "WorkSubmitted", "Approved", "Disputed", "Resolved", "Refunded"]);

/**
 * Emails the people involved in an escrow event, for each one who has a confirmed email address. `emails` maps
 * an address to { email, verified }. One email per person per event per transaction, even when a single
 * transaction funds several milestones. Returns how many emails were sent.
 */
export async function notifyParties(log, { emails, readJob, reviewPeriod, arbiter, send, appUrl, unsubscribeUrl, seen = new Set() }) {
  if (!NOTIFIED.has(log.eventName)) return 0;
  const job = await readJob(log.args.id);
  const messages = messagesFor(log.eventName, log.args, job, {
    reviewPeriod: await reviewPeriod(),
    arbiter: log.eventName === "Disputed" ? await arbiter() : undefined,
    appUrl,
  });
  let sent = 0;
  for (const message of messages) {
    const entry = emails[message.to.toLowerCase()];
    if (!entry?.verified) continue;
    const key = `${log.transactionHash}:${log.eventName}:${message.to.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    try {
      await send({ to: entry.email, subject: message.subject, text: `${message.text}\n\n—\nStop these emails: ${unsubscribeUrl(message.to, entry.email)}` });
      sent++;
    } catch (e) {
      console.error(`[mail] could not email ${message.to}:`, e.message);
    }
  }
  return sent;
}
