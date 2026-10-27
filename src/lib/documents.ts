// How job text and files are recorded.
//
// On-chain a job's `description` is "<title>" or "<title>\n<spec>", where <spec> is either plain text or a
// pointer "fg:<sha256>" to a small JSON document held by the backend. A milestone's `deliverable` is either
// plain text (a link or a note) or such a pointer. The document lists the files with their SHA-256 hashes, so
// what was delivered is tamper-evident. A job's document can also carry billing details (a PO or invoice
// reference, and company names and VAT IDs), which the hash protects the same way. Jobs created before this
// existed are plain text and still read fine.
// No imports here on purpose: this file is unit-tested on its own.

export type DocFile = { name: string; size: number; type: string; sha256: string };
/** Business details a payer can attach to a job. All optional, and as entered by the payer: nothing here is verified. */
export type Billing = { reference?: string; payerName?: string; payerVatId?: string; payeeName?: string; payeeVatId?: string };
export type Doc = { version: 1; title?: string; text: string; files: DocFile[]; billing?: Billing };

const BILLING_KEYS = ["reference", "payerName", "payerVatId", "payeeName", "payeeVatId"] as const;
/** The longest value each billing field may have. The form uses them as input limits. */
export const BILLING_MAX: Record<(typeof BILLING_KEYS)[number], number> = { reference: 60, payerName: 100, payerVatId: 30, payeeName: 100, payeeVatId: 30 };

/** Billing details with blanks and stray whitespace removed, or undefined when nothing was entered. */
export function cleanBilling(input: Billing | undefined): Billing | undefined {
  const out: Billing = {};
  for (const key of BILLING_KEYS) {
    const value = (input?.[key] ?? "").replace(/\s+/g, " ").trim().slice(0, BILLING_MAX[key]);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseBilling(value: unknown): Billing | undefined | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: Billing = {};
  for (const key of BILLING_KEYS) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "string" || (raw[key] as string).length > BILLING_MAX[key]) return null;
    out[key] = raw[key] as string;
  }
  return cleanBilling(out);
}

/** The number printed on a receipt: the job and the milestone's place in it. */
export const receiptNumber = (id: number | string, index: number) => `RC-${id}-${index + 1}`;

/** The route of a receipt page. The milestone is numbered from 1 in the address, as in the emails. */
export const receiptPath = (id: number | string, index: number) => `/receipt/${id}/${index + 1}`;

const SHA256 = /^[0-9a-f]{64}$/;
const POINTER = /^fg:([0-9a-f]{64})$/;
const MAX_TITLE = 80;
const MAX_TEXT = 20_000;
const MAX_FILES = 20;

/** The title and spec of a job from its on-chain description. */
export function parseDescription(description: string) {
  const text = description.trim();
  const newline = text.indexOf("\n");
  if (newline === -1) {
    // Older jobs: one line of text. A long one becomes a shortened title, with the whole text as the spec.
    return text.length > MAX_TITLE ? { title: `${text.slice(0, MAX_TITLE - 1)}…`, spec: text, ref: undefined } : { title: text, spec: "", ref: undefined };
  }
  const title = text.slice(0, newline).trim();
  const rest = text.slice(newline + 1).trim();
  const ref = rest.match(POINTER)?.[1];
  return { title, spec: ref ? "" : rest, ref };
}

/** The text a wallet signs to sign in for uploads. The backend builds the same text (server/auth.mjs) and a test keeps them equal. */
export const signInMessage = (address: string, issuedAt: string) => ["Squirrel", "Sign in to upload files and manage notifications.", `Address: ${address}`, `Issued: ${issuedAt}`].join("\n");

export const jobTitle = (description: string, id: number | string) => parseDescription(description).title || `Job #${id}`;

/** The on-chain description for a title plus a spec, given either as text or as a document pointer. */
export function buildDescription(title: string, spec: { text?: string; ref?: string }) {
  const clean = title.replace(/\s+/g, " ").trim();
  const tail = spec.ref ? `fg:${spec.ref}` : (spec.text ?? "").trim();
  return tail ? `${clean}\n${tail}` : clean;
}

/** A deliverable is either a pointer to a document, or plain text typed by the payee. */
export function parseDeliverable(value: string): { ref?: string; text: string } {
  const ref = value.trim().match(POINTER)?.[1];
  return ref ? { ref, text: "" } : { text: value };
}

/** The exact text that is hashed and stored for a document. */
export const serializeDoc = (doc: Doc) =>
  JSON.stringify({
    version: 1,
    ...(doc.title ? { title: doc.title } : {}),
    text: doc.text,
    files: doc.files.map(({ name, size, type, sha256 }) => ({ name, size, type, sha256 })),
    ...(cleanBilling(doc.billing) ? { billing: cleanBilling(doc.billing) } : {}),
  });

/** A document read back from storage, or null if it isn't well formed. Anything unexpected is dropped. */
export function parseDoc(raw: string): Doc | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = value as { version?: unknown; title?: unknown; text?: unknown; files?: unknown; billing?: unknown };
  if (!d || d.version !== 1 || typeof d.text !== "string" || d.text.length > MAX_TEXT) return null;
  if (d.title !== undefined && typeof d.title !== "string") return null;
  if (!Array.isArray(d.files) || d.files.length > MAX_FILES) return null;
  const files: DocFile[] = [];
  for (const f of d.files) {
    const file = f as Partial<DocFile> | null;
    if (!file || typeof file.name !== "string" || typeof file.type !== "string" || typeof file.size !== "number" || file.size < 0 || typeof file.sha256 !== "string" || !SHA256.test(file.sha256)) return null;
    files.push({ name: file.name, size: file.size, type: file.type, sha256: file.sha256 });
  }
  const billing = d.billing === undefined ? undefined : parseBilling(d.billing);
  if (billing === null) return null;
  return { version: 1, ...(d.title ? { title: d.title as string } : {}), text: d.text, files, ...(billing ? { billing } : {}) };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A link for a deliverable, or null when it isn't a web or IPFS address. The deliverable is text the
 * payee typed, so only http(s) and ipfs links are ever turned into a clickable href.
 */
export function deliverableUrl(value: string): string | null {
  const text = value.trim();
  if (/^https?:\/\/\S+$/i.test(text)) return text;
  const ipfs = text.match(/^ipfs:\/\/(?:ipfs\/)?(\S+)$/i);
  return ipfs ? `https://ipfs.io/ipfs/${ipfs[1]}` : null;
}
