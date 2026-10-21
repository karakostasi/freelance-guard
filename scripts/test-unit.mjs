// Unit tests for the pure parts: the document format, the sign-in sessions, and the file stores.
// Run with: npm run test:unit
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { buildDescription, deliverableUrl, formatBytes, jobTitle, parseDeliverable, parseDescription, parseDoc, serializeDoc, signInMessage as frontendMessage } from "../src/lib/documents.ts";
import { formatBalance } from "../src/lib/format.ts";
import { ETH_GAS_BUFFER, checkSend, maxSendable, parseAmount } from "../src/lib/send.ts";
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

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
