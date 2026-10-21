import { signMessage } from "wagmi/actions";
import { config } from "../wagmi";
import { API_URL } from "./api";
import { parseDoc, serializeDoc, signInMessage, type Doc, type DocFile } from "./documents";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 5;

export async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

let session: { token: string; address: string; expiresAt: number } | null = null;

/** Signs in once an hour, with a signature from the wallet, so the backend knows who is uploading. */
async function sessionToken(address: string) {
  if (session && session.address === address.toLowerCase() && session.expiresAt - Date.now() > 60_000) return session.token;
  const issuedAt = new Date().toISOString();
  const signature = await signMessage(config, { message: signInMessage(address, issuedAt) });
  const res = await fetch(`${API_URL}/api/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, issuedAt, signature }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Sign-in failed");
  session = body as typeof session;
  return session!.token;
}

async function upload(bytes: ArrayBuffer, name: string, type: string, address: string) {
  const local = await sha256Hex(bytes);
  const res = await fetch(`${API_URL}/api/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${await sessionToken(address)}`, "content-type": type || "application/octet-stream", "x-file-name": encodeURIComponent(name) },
    body: bytes,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
  // Don't just trust the server's word for what it stored.
  if ((body as { sha256?: string }).sha256 !== local) throw new Error("The server stored different bytes than were sent");
  return local;
}

export async function uploadFile(file: File, address: string): Promise<DocFile> {
  const type = file.type || "application/octet-stream";
  return { name: file.name, size: file.size, type, sha256: await upload(await file.arrayBuffer(), file.name, type, address) };
}

/** Stores a document and returns the hash that points to it. */
export async function uploadDoc(doc: Doc, address: string) {
  const bytes = new TextEncoder().encode(serializeDoc(doc));
  return upload(bytes.buffer as ArrayBuffer, "document.json", "application/json", address);
}

export const fileUrl = (sha256: string, name?: string) => `${API_URL}/api/files/${sha256}${name ? `?name=${encodeURIComponent(name)}` : ""}`;

/** Reads a document from the backend and checks it really is the one the hash points to. */
export async function loadDoc(sha256: string): Promise<Doc> {
  const res = await fetch(fileUrl(sha256));
  if (!res.ok) throw new Error(res.status === 404 ? "The file service doesn't have this document" : `Could not load the document (${res.status})`);
  const bytes = await res.arrayBuffer();
  if ((await sha256Hex(bytes)) !== sha256) throw new Error("The document doesn't match its recorded hash");
  const doc = parseDoc(new TextDecoder().decode(bytes));
  if (!doc) throw new Error("The document isn't in a format this app understands");
  return doc;
}

/** Downloads a file and checks it matches the hash that was recorded for it. */
export async function verifyFile(file: DocFile) {
  const res = await fetch(fileUrl(file.sha256));
  if (!res.ok) return false;
  return (await sha256Hex(await res.arrayBuffer())) === file.sha256;
}
