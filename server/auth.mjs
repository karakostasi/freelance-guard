import { createHmac, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress } from "viem";

export const SESSION_MS = 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

const secret = () => process.env.SESSION_SECRET || process.env.WEBHOOK_SECRET || "dev-webhook-secret";
const b64 = (data) => Buffer.from(data).toString("base64url");
const mac = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** The text a wallet signs to prove it controls an address. The frontend builds the same text. */
export const signInMessage = (address, issuedAt) => ["Freelance Guard", "Sign in to upload files.", `Address: ${address}`, `Issued: ${issuedAt}`].join("\n");

const unauthorized = (msg) => Object.assign(new Error(msg), { status: 401 });

/**
 * Checks a signed sign-in message and returns a session token valid for an hour.
 *
 * A normal wallet's signature is checked right here. A smart wallet (such as a passkey account) signs in a
 * different way that can only be checked by asking the chain, so `verifyOnChain` is the fallback for those.
 */
export async function createSession({ address, issuedAt, signature }, now = Date.now(), verifyOnChain) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) throw unauthorized("Invalid address");
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued) || Math.abs(now - issued) > MAX_CLOCK_SKEW_MS) throw unauthorized("The sign-in message is too old or too new");
  const message = signInMessage(address, issuedAt);
  let signer;
  try {
    signer = await recoverMessageAddress({ message, signature });
  } catch {
    // not a plain 65-byte signature: it may be a smart wallet's
  }
  if (signer?.toLowerCase() !== address.toLowerCase()) {
    let valid = false;
    try {
      valid = !!(await verifyOnChain?.({ address, message, signature }));
    } catch {
      // the chain could not confirm it
    }
    if (!valid) throw unauthorized(signer ? "The signature is not from that address" : "Invalid signature");
  }
  const payload = b64(JSON.stringify({ a: address.toLowerCase(), e: now + SESSION_MS }));
  return { token: `${payload}.${mac(payload)}`, expiresAt: now + SESSION_MS, address: address.toLowerCase() };
}

/** The address a session token belongs to, or null if it is forged, malformed or expired. */
export function verifyToken(token, now = Date.now()) {
  const [payload, given] = String(token ?? "").split(".");
  if (!payload || !given) return null;
  const expected = Buffer.from(mac(payload));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return e > now ? a : null;
  } catch {
    return null;
  }
}
