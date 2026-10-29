// Unit tests for the pure parts: the document format, the sign-in sessions, and the file stores.
// Run with: npm run test:unit
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { BILLING_MAX, buildDescription, cleanBilling, deliverableUrl, formatBytes, jobTitle, parseDeliverable, parseDescription, parseDoc, receiptNumber, receiptPath, serializeDoc, signInMessage as frontendMessage } from "../src/lib/documents.ts";
import { computeReputation, jobKey } from "../src/lib/reputation.ts";
import { reminderFor } from "../src/lib/reminders.ts";
import { formatBalance } from "../src/lib/format.ts";
import { milestoneFeeShare, surchargeOn } from "../src/lib/fees.ts";
import { START_RANGE, logsFrom, rangeRefused } from "../server/logs.mjs";
import { cleanPayout, currencyOfRoute, isValidIban, isValidRouting, publicPayout } from "../server/payout.mjs";
import { ETH_GAS_BUFFER, checkSend, maxSendable, parseAmount } from "../src/lib/send.ts";
import { cleanEmail, confirmToken, messagesFor, notifyParties, readEmailToken, unsubscribeToken } from "../server/emails.mjs";
import { sendMail } from "../server/mail.mjs";
import { SESSION_MS, createSession, signInMessage, verifyToken } from "../server/auth.mjs";
import { fsBlobStore, pgBlobStore } from "../server/blobs.mjs";

let failures = 0;
const check = (condition, message) => {
  console.log(condition ? "  PASS" : "  FAIL", message);
  if (!condition) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rejects = async (promise) => {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
};
const SHA = "a".repeat(64);

console.log("\nReading events from an RPC that limits the range");
{
  // A fake RPC that, like Base Sepolia's public one, refuses more than 200 blocks at a time.
  const asked = [];
  const limited = (max, words = (n) => `eth_getLogs is limited to a ${n} range`) => async (from, to) => {
    asked.push([from, to]);
    if (to - from + 1n > max) throw Object.assign(new Error("RPC Request failed."), { details: words(max) });
    return [`logs ${from}-${to}`];
  };
  const state = { range: START_RANGE };
  const first = await logsFrom(limited(200n), 1000n, 100_000n, state);
  check(first.to === 1199n && state.range === 200n && same(first.logs, ["logs 1000-1199"]), "a refused range becomes the one the RPC names, and the call still succeeds");
  const before = asked.length;
  const second = await logsFrom(limited(200n), first.to + 1n, 100_000n, state);
  check(asked.length === before + 1 && second.to === 1399n, "later calls ask for that size at once");
  const near = await logsFrom(limited(200n), 99_990n, 100_000n, { range: 200n });
  check(near.to === 100_000n, "the last piece stops at the latest block");
  const halved = await logsFrom(limited(10n, () => "query exceeds the block range"), 1n, 100_000n, { range: START_RANGE });
  check(halved.to - 1n + 1n <= 10n, "without a number in the message the range is halved until it is accepted");
  const unrelated = await rejects(logsFrom(async () => { throw Object.assign(new Error("rate limit exceeded, too many requests"), { details: "429" }); }, 1n, 100n));
  check(!!unrelated && !rangeRefused(unrelated), "a rate limit is an error, not a reason to ask for less");
  const down = await rejects(logsFrom(async () => { throw new Error("fetch failed"); }, 1n, 100n));
  check(down?.message === "fetch failed", "any other failure is passed on");
}

console.log("\nJob descriptions");
check(same(parseDescription("Logo design"), { title: "Logo design", spec: "", ref: undefined }), "a title alone");
check(same(parseDescription("Logo design\nA new logo for a bakery"), { title: "Logo design", spec: "A new logo for a bakery", ref: undefined }), "a title and a text spec");
check(same(parseDescription(`Logo design\nfg:${SHA}`), { title: "Logo design", spec: "", ref: SHA }), "a title and a document pointer");
check(same(parseDescription("Logo\r\nline one\r\nline two"), { title: "Logo", spec: "line one\r\nline two", ref: undefined }), "Windows line endings");
check(parseDescription("e2e job").title === "e2e job", "an old one-line description is its title");
const long = "x".repeat(200);
check(parseDescription(long).title.length === 80 && parseDescription(long).spec === long, "a long old description gets a short title and keeps its full text");
check(parseDescription(`Title\nfg:${"z".repeat(64)}`).ref === undefined, "a pointer must be a real SHA-256 hash");
check(jobTitle("", 7) === "Job #7" && jobTitle("  \n ", 7) === "Job #7", "an empty description falls back to the job number");
check(buildDescription("  Logo\n design  ", { text: " Make it blue " }) === "Logo design\nMake it blue", "building cleans the title and the spec");
check(buildDescription("Logo", { ref: SHA }) === `Logo\nfg:${SHA}` && buildDescription("Logo", {}) === "Logo", "building with a pointer, or with no spec");
const rebuilt = parseDescription(buildDescription("Logo design", { ref: SHA }));
check(rebuilt.title === "Logo design" && rebuilt.ref === SHA, "what is built can be parsed back");

console.log("\nDeliverables and links");
check(same(parseDeliverable(`fg:${SHA}`), { ref: SHA, text: "" }) && parseDeliverable("https://x.test/a").text === "https://x.test/a", "a pointer or plain text");
check(deliverableUrl("https://github.com/me/repo") === "https://github.com/me/repo", "an https link is linked");
check(deliverableUrl("ipfs://bafy123") === "https://ipfs.io/ipfs/bafy123", "an ipfs link goes through a gateway");
check(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "//evil.test", "https://a.test <script>", "plain words", ""].every((v) => deliverableUrl(v) === null), "scripts, data URLs and plain text are never linked");

console.log("\nDocuments");
const doc = { version: 1, title: "Draft", text: "See attached", files: [{ name: "draft.pdf", size: 1234, type: "application/pdf", sha256: SHA }] };
check(same(parseDoc(serializeDoc(doc)), doc), "a document survives a round trip");
check(serializeDoc({ ...doc, extra: "ignored" }) === serializeDoc(doc), "unknown fields are not stored, so the hash is stable");
check(parseDoc("not json") === null && parseDoc("[]") === null && parseDoc("null") === null, "garbage is not a document");
check(parseDoc(JSON.stringify({ ...doc, version: 2 })) === null, "an unknown version is rejected");
check(parseDoc(JSON.stringify({ ...doc, files: [{ ...doc.files[0], sha256: "nope" }] })) === null, "a file with a bad hash is rejected");
check(parseDoc(JSON.stringify({ ...doc, files: Array(21).fill(doc.files[0]) })) === null, "too many files are rejected");
check(parseDoc(JSON.stringify({ ...doc, text: "x".repeat(20_001) })) === null, "an oversized text is rejected");
check(parseDoc(JSON.stringify({ ...doc, files: [{ ...doc.files[0], size: -1 }] })) === null, "a negative size is rejected");

console.log("\nBilling details and receipts");
const billing = { reference: "PO-1042", payerName: "Acme GmbH", payerVatId: "DE123456789", payeeName: "Studio Nord AB", payeeVatId: "SE556677889901" };
check(same(parseDoc(serializeDoc({ ...doc, billing })), { ...doc, billing }), "billing details survive a round trip inside the document");
check(!serializeDoc(doc).includes("billing") && serializeDoc({ ...doc, billing: {} }) === serializeDoc(doc) && serializeDoc({ ...doc, billing: { reference: "   " } }) === serializeDoc(doc), "no details, no billing key: hashes of older documents don't change");
check(serializeDoc({ ...doc, billing: { payeeName: "B", reference: "A" } }) === serializeDoc({ ...doc, billing: { reference: "A", payeeName: "B" } }), "the order the fields were typed in doesn't change the hash");
check(same(cleanBilling({ reference: "  PO   1042 ", payerName: "" }), { reference: "PO 1042" }) && cleanBilling({ reference: "  " }) === undefined && cleanBilling(undefined) === undefined, "details are trimmed and blanks dropped");
check(cleanBilling({ reference: "x".repeat(200) }).reference.length === BILLING_MAX.reference, "an over-long value is cut to its limit");
check(same(parseDoc(JSON.stringify({ ...doc, billing: { ...billing, extra: "ignored" } })).billing, billing), "unknown billing fields are dropped on reading");
check(parseDoc(JSON.stringify({ ...doc, billing: "PO-1" })) === null && parseDoc(JSON.stringify({ ...doc, billing: [] })) === null && parseDoc(JSON.stringify({ ...doc, billing: { reference: 5 } })) === null, "billing that isn't an object of strings is rejected");
check(parseDoc(JSON.stringify({ ...doc, billing: { reference: "x".repeat(BILLING_MAX.reference + 1) } })) === null, "an over-long reference is rejected");
check(receiptNumber(12, 1) === "RC-12-2" && receiptPath(12, 1) === "/receipt/12/2", "receipts are numbered by job and milestone, from 1");
check(formatBytes(512) === "512 B" && formatBytes(2048) === "2.0 KB" && formatBytes(5 * 1024 * 1024) === "5.0 MB", "file sizes are readable");

console.log("\nBalances");
const ONE_ETH = 10n ** 18n;
check(formatBalance(0n, 18) === "0" && formatBalance(5n * ONE_ETH, 18) === "5", "zero and whole amounts");
check(formatBalance(12300000000000000n, 18) === "0.0123", "ETH is trimmed, not shown with 18 digits");
check(formatBalance(1234567890123456789n, 18) === "1.234567", "long balances stop at 6 decimals");
check(formatBalance(1_500_000n, 6) === "1.5" && formatBalance(500_000_000n, 6) === "500", "6-decimal tokens (EURC, USDC)");
check(formatBalance(1n, 6) === "0.000001" && formatBalance(5n, 6) === "0.000005", "the smallest token unit is still shown exactly");
check(formatBalance(1n, 18) === "< 0.000001" && formatBalance(999_999_999_999n, 18) === "< 0.000001", "ETH dust below 6 decimals is shown as less than 0.000001, not 0");
check(formatBalance(42n, 0) === "42" && formatBalance(0n, 0) === "0", "a token with no decimals");
check(formatBalance(1_000_001n, 6) === "1.000001" && formatBalance(10_000_000n, 6) === "10", "no stray zeros or lost digits");

console.log("\nSending funds");
check(parseAmount("1.5", 6) === 1_500_000n && parseAmount("0.000001", 6) === 1n && parseAmount("7", 18) === 7n * 10n ** 18n && parseAmount(".5", 6) === 500_000n && parseAmount("5.", 6) === null, "amounts become base units");
check(["", " ", ".", "abc", "-1", "1e3", "1,5", "0.0000001", "1.2.3", "0x10"].every((t) => parseAmount(t, 6) === null), "anything that isn't a plain amount in that precision is refused");
const me = "0x" + "1".repeat(40);
const you = "0x" + "2".repeat(40);
const base = { to: you, from: me, amountText: "5", decimals: 6, symbol: "EURC", balance: 10_000_000n, isNative: false };
check(checkSend(base).error === null && checkSend(base).units === 5_000_000n, "a normal send passes and gives the exact units");
check(checkSend({ ...base, to: "" }).error !== null && checkSend({ ...base, to: "0x123" }).error !== null && checkSend({ ...base, to: "z".repeat(42) }).error !== null, "a missing or malformed address is refused");
check(checkSend({ ...base, to: me.toUpperCase().replace("0X", "0x") }).error === "That's your own address.", "sending to yourself is refused, whatever the letter case");
check(checkSend({ ...base, amountText: "0" }).error !== null && checkSend({ ...base, amountText: "" }).error !== null && checkSend({ ...base, amountText: "1.0000001" }).error !== null, "zero, empty and too-precise amounts are refused");
check(checkSend({ ...base, amountText: "10.000001" }).error !== null && checkSend({ ...base, amountText: "10" }).error === null, "more than the balance is refused, exactly the balance is fine for a token");
check(checkSend({ ...base, balance: undefined }).error === "Loading your balance…", "nothing is sent before the balance is known");
const eth = { ...base, symbol: "ETH", decimals: 18, balance: 10n ** 18n, isNative: true, amountText: "1" };
check(checkSend(eth).error !== null && checkSend({ ...eth, amountText: "0.5" }).error === null, "for ETH the whole balance can't be sent, so the fee can be paid");
check(maxSendable(10n ** 18n, true) === 10n ** 18n - ETH_GAS_BUFFER && maxSendable(ETH_GAS_BUFFER, true) === 0n && maxSendable(123n, false) === 123n, "max keeps a fee buffer for ETH only");
check(checkSend({ ...eth, amountText: "0.999950000000000000" }).error === null && checkSend({ ...eth, amountText: "0.99996" }).error !== null, "the buffer boundary is exact");

console.log("\nSign-in sessions");
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
check(frontendMessage(account.address, "2026-01-01T00:00:00.000Z") === signInMessage(account.address, "2026-01-01T00:00:00.000Z"), "the frontend and the backend build the same sign-in text");
const now = Date.now();
const issuedAt = new Date(now).toISOString();
const signature = await account.signMessage({ message: signInMessage(account.address, issuedAt) });
const session = await createSession({ address: account.address, issuedAt, signature }, now);
check(verifyToken(session.token, now) === account.address.toLowerCase(), "a valid signature gives a token that names the address");
check(verifyToken(session.token, now + SESSION_MS + 1) === null, "the token expires after an hour");
check(verifyToken(session.token.slice(0, -2) + "xx", now) === null && verifyToken("garbage", now) === null && verifyToken("", now) === null, "forged or malformed tokens are refused");
const [payload] = session.token.split(".");
const forged = Buffer.from(JSON.stringify({ a: other.address.toLowerCase(), e: now + SESSION_MS })).toString("base64url");
check(verifyToken(`${forged}.${session.token.split(".")[1]}`, now) === null && payload !== forged, "changing the address inside a token breaks it");
const wrongSigner = await other.signMessage({ message: signInMessage(account.address, issuedAt) });
check((await rejects(createSession({ address: account.address, issuedAt, signature: wrongSigner }, now)))?.status === 401, "a signature from another wallet is refused");
check((await rejects(createSession({ address: account.address, issuedAt, signature }, now + 11 * 60_000)))?.status === 401, "an old sign-in message cannot be replayed");
check((await rejects(createSession({ address: account.address, issuedAt: new Date(now + 60_000).toISOString(), signature }, now)))?.status === 401, "a signature for a different time than claimed is refused");
check((await rejects(createSession({ address: account.address, issuedAt, signature: "0x1234" }, now)))?.status === 401, "a garbage signature is refused");
check((await rejects(createSession({ address: "nope", issuedAt, signature }, now)))?.status === 401, "a bad address is refused");

console.log("\nFile stores");
const dir = mkdtempSync(join(tmpdir(), "fg-blobs-"));
try {
  const fs = fsBlobStore(dir);
  await fs.put(SHA, Buffer.from("hello"));
  check((await fs.get(SHA)).toString() === "hello" && (await fs.get("b".repeat(64))) === null, "the folder store saves and reads back, and misses return null");
  check((await rejects(fs.get("../../etc/passwd"))) instanceof Error && (await rejects(fs.put("../x", Buffer.from("x")))) instanceof Error, "only SHA-256 hashes are accepted, so no path tricks");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const statements = [];
const rows = new Map();
const pool = {
  async query(text, params) {
    statements.push(text.trim().split(/\s+/).slice(0, 3).join(" ").toLowerCase());
    if (/^select/i.test(text.trim())) return { rows: rows.has(params[0]) ? [{ data: rows.get(params[0]) }] : [] };
    if (/^insert/i.test(text.trim())) {
      if (!rows.has(params[0])) rows.set(params[0], params[1]);
    }
    return { rows: [] };
  },
};
const pg = await pgBlobStore(pool);
check(statements[0].startsWith("create table") && statements[1].startsWith("alter table"), "the Postgres store creates its table and turns on row level security");
await pg.put(SHA, Buffer.from("one"));
await pg.put(SHA, Buffer.from("two"));
check(Buffer.from(await pg.get(SHA)).toString() === "one", "storing the same hash twice keeps the first (content is the same anyway)");
check((await pg.get("c".repeat(64))) === null && (await rejects(pg.get("'; drop table x;--"))) instanceof Error, "misses return null, and a hash is validated before it reaches SQL");

console.log("\nReputation");
const C = "0xc1", F = "0xf1";
const ms = (status, submitted = false) => ({ title: "", amount: 1n, duration: 1, deadline: 0n, submittedAt: submitted ? 1n : 0n, status, deliverable: "" });
const job = (...milestones) => ({ payer: C, payee: F, token: "0x0", description: "", milestones });
const rep = (jobs, who, disputed = []) => computeReputation(jobs.map((j, i) => ({ id: i + 1, job: j })), who, new Set(disputed));
check(rep([], C).asPayer.tier === "new" && rep([], C).asPayer.jobs === 0, "an account with no jobs is New");
check(rep([job(ms(4, true), ms(4, true))], C).asPayer.tier === "new", "two paid milestones are still too little history");
check(rep([job(ms(4, true), ms(4, true), ms(4, true))], C).asPayer.tier === "good", "three paid milestones, no disputes: Reliable");
check(rep([job(ms(4, true), ms(4, true), ms(4, true))], F).asPayee.paid === 3, "paid milestones count for the payee too");
check(rep([job(ms(4, true), ms(4, true), ms(4, true))], C).asPayee.jobs === 0, "a payer has no payee record");
const lost = rep([job(ms(4, true), ms(4, true), ms(4, true))], C, [jobKey(1, 0)]).asPayer;
check(lost.disputes === 1 && lost.disputesLost === 1 && lost.tier === "risky", "a dispute the payer lost (known from the events) counts against the payer");
check(rep([job(ms(4, true), ms(4, true), ms(4, true))], C).asPayer.disputes === 0, "without the events, a resolved dispute that paid out is not visible");
const won = rep([job(ms(5, true), ms(4, true), ms(4, true))], F).asPayee;
check(won.disputes === 1 && won.disputesLost === 1 && won.tier === "risky", "a refund after delivery is a dispute the payee lost, even without events");
check(rep([job(ms(5, true), ms(4, true), ms(4, true))], C).asPayer.bad === 0, "a dispute the payer won does not count against the payer");
const missed = rep([job(ms(5, false), ms(4, true), ms(4, true), ms(4, true))], F).asPayee;
check(missed.missed === 1 && missed.bad === 1 && missed.finished === 4 && missed.tier === "mixed", "a refund for a missed deadline counts against the payee");
check(rep([job(ms(5, false), ms(4, true), ms(4, true), ms(4, true))], C).asPayer.tier === "good", "a missed deadline does not count against the payer");
check(rep([job(ms(3, true))], C).asPayer.disputes === 1 && rep([job(ms(3, true))], C).asPayer.finished === 0, "an open dispute is counted but not yet decided");
check(rep([job(...Array.from({ length: 9 }, () => ms(4, true)), ms(5, false))], F).asPayee.tier === "good", "1 bad in 10 is still Reliable");
check(rep([job(...Array.from({ length: 8 }, () => ms(4, true)), ms(5, false), ms(5, false))], F).asPayee.tier === "mixed", "2 bad in 10 is a Mixed record");

console.log("\nReminders");
const RP = 259200n, DAYS = 86400n, T0 = 1_000_000n;
const rm = (status, o = {}) => ({ title: "", amount: 1n, duration: 1, deadline: 0n, submittedAt: 0n, status, deliverable: "", ...o });
const rjob = (...milestones) => ({ payer: C, payee: F, token: "0x0", description: "", milestones });
const remind = (j, who, now) => reminderFor(j, who, RP, now);
const submitted = rjob(rm(2, { submittedAt: T0 }));
check(remind(submitted, C, T0 + DAYS)?.text === "Review ends in 2d 0h. Approve or report a problem" && remind(submitted, C, T0 + DAYS).tone === "info", "the payer sees the review countdown");
check(remind(submitted, C, T0 + 2n * DAYS + 3600n)?.tone === "warn", "under a day left turns the countdown into a warning");
check(remind(submitted, F, T0 + DAYS)?.text === "Payer review ends in 2d 0h", "the payee sees when the payer's review ends");
check(remind(submitted, F, T0 + RP)?.tone === "action" && remind(submitted, F, T0 + RP).text.includes("Claim your payment"), "once the review period ends the payee is told to claim");
check(remind(submitted, C, T0 + RP)?.tone === "warn", "the payer is warned the payee can now claim");
const funded = rjob(rm(1, { deadline: T0 + 5n * DAYS }));
check(remind(funded, F, T0)?.text === "Deliver in 5d 0h", "the payee sees the delivery countdown");
check(remind(funded, C, T0 + 5n * DAYS + 1n)?.tone === "action", "after the deadline the payer is told they can take a refund");
check(remind(funded, F, T0 + 5n * DAYS + 1n)?.tone === "warn", "after the deadline the payee is warned");
check(remind(rjob(rm(4), rm(2, { submittedAt: T0 })), C, T0)?.milestone === 1, "it looks at the first milestone that isn't finished");
check(remind(rjob(rm(4), rm(5)), C, T0) === undefined && remind(rjob(rm(0)), C, T0) === undefined && remind(rjob(rm(3)), C, T0) === undefined, "nothing to say for finished, unfunded or disputed milestones");
check(remind(submitted, "0xother", T0) === undefined, "nothing for someone who isn't a party");
check(reminderFor(submitted, C, undefined, T0 + DAYS) === undefined, "nothing until the review period is known");

console.log("\nEmail notifications");
{
const ME = "0x" + "a".repeat(40), YOU = "0x" + "b".repeat(40);
check(cleanEmail(" a@b.co ") === "a@b.co" && cleanEmail("nope") === null && cleanEmail("a b@c.d") === null && cleanEmail("a@b") === null && cleanEmail("a".repeat(250) + "@b.co") === null, "emails are checked and trimmed");
const T0n = 1_000_000;
const token = confirmToken(ME, "a@b.co", T0n);
check(readEmailToken(token, "confirm", T0n + 1000)?.email === "a@b.co" && readEmailToken(token, "confirm", T0n + 1000).address === ME, "a confirm token carries the address and email");
check(readEmailToken(token, "confirm", T0n + 25 * 3600 * 1000) === null, "a confirm token expires after a day");
check(readEmailToken(token, "unsub", T0n + 1000) === null, "a confirm token is not an unsubscribe token");
check(readEmailToken(token.slice(0, -2) + "xx", "confirm", T0n + 1000) === null && readEmailToken("garbage", "confirm") === null, "a forged or broken token is refused");
check(readEmailToken(unsubscribeToken(ME, "a@b.co", T0n), "unsub", T0n + 30 * 24 * 3600 * 1000)?.address === ME, "an unsubscribe link works for months");
check(verifyToken(token) === null, "an email token can't be used as a sign-in session");

const ARB = "0x" + "c".repeat(40);
const escrowJob = { payer: ME, payee: YOU };
const opts = { reviewPeriod: 259200n, arbiter: ARB, appUrl: "https://app" };
const to = (messages, who) => messages.find((m) => m.to === who);
const funding = messagesFor("MilestoneFunded", { id: 4n, milestone: 0n }, escrowJob, opts);
check(funding.length === 2 && to(funding, YOU).subject === "Job #4 has been funded" && to(funding, ME).subject === "You funded job #4", "funding tells the payee to start and gives the payer a receipt");
const submission = messagesFor("WorkSubmitted", { id: 4n, milestone: 1n }, escrowJob, opts);
check(to(submission, ME).text.includes("3 days") && to(submission, ME).text.includes("https://app/#/flow/4") && to(submission, ME).text.includes("milestone 2") && to(submission, YOU).subject.includes("was submitted"), "a submission tells the payer what to do, and the payee it is with the payer");
check(to(messagesFor("Approved", { id: 4n, milestone: 0n }, escrowJob, opts), YOU).subject === "Payment released for job #4" && messagesFor("Approved", { id: 4n, milestone: 0n }, escrowJob, opts).length === 2, "a payment release goes to both");
const released = messagesFor("Approved", { id: 4n, milestone: 1n }, escrowJob, opts);
check(released.every((m) => m.text.includes(`Receipt: https://app/#${receiptPath(4, 1)}`)), "a payment release links both people to the receipt, at the address the frontend uses");
check(messagesFor("Resolved", { id: 4n, milestone: 0n, paidPayee: true }, escrowJob, opts).every((m) => m.text.includes("Receipt: https://app/#/receipt/4/1")), "an arbiter's payment links to the receipt too");
check(messagesFor("Refunded", { id: 4n, milestone: 0n }, escrowJob, opts).every((m) => !m.text.includes("Receipt")), "a refund has no receipt link");
const arbitrated = messagesFor("Resolved", { id: 4n, milestone: 0n, paidPayee: true }, escrowJob, opts);
check(arbitrated.length === 2 && to(arbitrated, YOU).text.includes("arbiter decided"), "the arbiter paying the payee is announced as a payment");
check(messagesFor("Resolved", { id: 4n, milestone: 0n, paidPayee: false }, escrowJob, opts).length === 0, "an arbiter refund is announced by the Refunded event, not twice");
check(messagesFor("Refunded", { id: 4n, milestone: 0n }, escrowJob, opts).length === 2, "a refund goes to both");
const dispute = messagesFor("Disputed", { id: 4n, milestone: 0n }, escrowJob, opts);
check(dispute.length === 3 && to(dispute, ARB).subject.includes("needs your decision"), "a dispute also asks the arbiter to decide");
check(messagesFor("JobCreated", { id: 4n }, escrowJob, opts).length === 0, "other events send nothing");

const sent = [];
const deps = (emails) => ({ emails, readJob: async () => escrowJob, reviewPeriod: async () => 259200n, arbiter: async () => ARB, send: async (m) => sent.push(m), appUrl: "https://app", unsubscribeUrl: (a) => `https://api/unsub/${a}`, seen: new Set() });
const funded = { eventName: "MilestoneFunded", args: { id: 1n, milestone: 0n }, transactionHash: "0xt1" };
const both = { [YOU]: { email: "f@x.io", verified: true }, [ME]: { email: "c@x.io", verified: true } };
const d1 = deps(both);
check((await notifyParties(funded, d1)) === 2 && sent.map((m) => m.to).sort().join() === "c@x.io,f@x.io" && sent[0].text.includes("https://api/unsub/"), "both people are emailed, each with an unsubscribe link");
check((await notifyParties({ ...funded, args: { id: 1n, milestone: 1n } }, d1)) === 0 && sent.length === 2, "funding several milestones in one transaction sends one email each");
check((await notifyParties({ ...funded, transactionHash: "0xt2" }, d1)) === 2 && sent.length === 4, "a different transaction sends again");
const before = sent.length;
check((await notifyParties(funded, deps({ [YOU]: { email: "f@x.io", verified: false }, [ME]: { email: "c@x.io", verified: true } }))) === 1 && sent.length === before + 1 && sent.at(-1).to === "c@x.io", "only people with a confirmed email are emailed");
check((await notifyParties(funded, deps({}))) === 0, "nobody registered, nothing sent");
check((await notifyParties({ eventName: "Disputed", args: { id: 1n, milestone: 0n }, transactionHash: "0xt5" }, deps({ ...both, [ARB]: { email: "a@x.io", verified: true } }))) === 3, "a dispute reaches the payer, the payee and the arbiter");
const flaky = deps(both);
let first = true;
flaky.send = async (m) => {
  if (first) { first = false; throw new Error("boom"); }
  sent.push(m);
};
const n0 = sent.length;
check((await notifyParties({ ...funded, transactionHash: "0xt6" }, flaky)) === 1 && sent.length === n0 + 1, "one email failing doesn't stop the other");

const calls = [];
const fakeFetch = async (url, init) => (calls.push({ url, init }), { ok: calls.length !== 3, status: 422 });
check((await sendMail({ to: "a@b.co", subject: "s", text: "t" }, { fetchImpl: fakeFetch, env: {} })).sent === false && calls.length === 0, "without an API key nothing is sent");
const mailed = await sendMail({ to: "a@b.co", subject: "s", text: "t" }, { fetchImpl: fakeFetch, env: { RESEND_API_KEY: "k", MAIL_FROM: "Me <me@x.io>" } });
check(mailed.sent && calls[0].url === "https://api.resend.com/emails" && calls[0].init.headers.authorization === "Bearer k" && JSON.parse(calls[0].init.body).from === "Me <me@x.io>" && JSON.parse(calls[0].init.body).to[0] === "a@b.co", "with a key the email goes to Resend");
await sendMail({ to: "a@b.co", subject: "s", text: "t" }, { fetchImpl: fakeFetch, env: { RESEND_API_KEY: "k" } });
check((await rejects(sendMail({ to: "a@b.co", subject: "s", text: "t" }, { fetchImpl: fakeFetch, env: { RESEND_API_KEY: "k" } })))?.message.includes("422"), "a refusal from the email service is an error");
}

console.log("\nFees (the same numbers as the contract tests, in 6-decimal units)");
{
  const U = (n) => BigInt(Math.round(n * 1e6));
  // A 12,000 + 8,000 job has a fee of 50, shared 30 and 20.
  check(milestoneFeeShare(U(50), U(12000), U(20000)) === U(30) && milestoneFeeShare(U(50), U(8000), U(20000)) === U(20), "a job fee is shared between milestones by amount");
  check(milestoneFeeShare(U(40), U(1000), U(2000)) === U(20), "the minimum fee is shared the same way");
  // 40 over three equal thirds rounds down, so the payee keeps the dust.
  check(milestoneFeeShare(40n, 1n, 3n) === 13n && 3n * 13n === 39n, "the share rounds down");
  check(milestoneFeeShare(U(50), U(1), 0n) === 0n, "a job with no total has no fee share");
  check(surchargeOn(U(12000), 25) === U(30) && surchargeOn(U(8000), 25) === U(20), "the surcharge is 0.25% of each milestone");
  check(surchargeOn(U(12000), 0) === 0n, "a job that takes the yield pays no surcharge");
  check(surchargeOn(399n, 25) === 0n && surchargeOn(400n, 25) === 1n, "the surcharge rounds down");
}

console.log("\nHow a payee is paid");
{
  check(isValidIban("DE89 3704 0044 0532 0130 00") && isValidIban("gb82west12345698765432"), "real IBANs pass, with spaces or in lower case");
  check(!isValidIban("DE00 3704 0044 0532 0130 00") && !isValidIban("DE89") && !isValidIban(""), "a wrong check number, a short one and an empty one fail");
  check(isValidRouting("021000021") && !isValidRouting("021000022") && !isValidRouting("12345"), "a routing number needs nine digits that pass the ABA check");
  const sepa = cleanPayout({ route: "sepa", holder: "  Ana   Ferreira ", iban: "de89 3704 0044 0532 0130 00" });
  check(sepa.route === "sepa" && sepa.holder === "Ana Ferreira" && sepa.iban === "DE89370400440532013000", "a bank choice is tidied up before it is saved");
  check(cleanPayout({ route: "eurc" }).route === "eurc", "keeping the stablecoin needs no account");
  const bad = (body) => { try { cleanPayout(body); return null; } catch (e) { return e.status; } };
  check(bad({ route: "paypal" }) === 400 && bad({ route: "sepa", holder: "Ana", iban: "nope" }) === 400 && bad({ route: "sepa", iban: "DE89370400440532013000" }) === 400, "an unknown route, a bad IBAN and a missing name are refused");
  check(bad({ route: "ach", holder: "Ana", routing: "021000021", account: "12" }) === 400 && bad({ route: "ach", holder: "Ana", routing: "021000021", account: "12345678" }) === null, "a US account needs 4 to 17 digits");
  const shown = publicPayout(cleanPayout({ route: "sepa", holder: "Ana", iban: "DE89370400440532013000" }));
  check(shown.route === "sepa" && shown.currency === "EUR" && shown.last4 === "3000" && !JSON.stringify(shown).includes("DE89"), "what anyone sees is the route, the currency and the last four digits");
  check(publicPayout(undefined).route === null && currencyOfRoute("eurc") === null && currencyOfRoute("ach") === "USD", "no choice, and the currency of each route");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
