// Unit tests for the pure parts: the document format, the sign-in sessions, and the file stores.
// Run with: npm run test:unit
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { buildDescription, deliverableUrl, formatBytes, jobTitle, parseDeliverable, parseDescription, parseDoc, serializeDoc, signInMessage as frontendMessage } from "../src/lib/documents.ts";
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
