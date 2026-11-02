// The parts of the Coinbase Onramp/Offramp check that don't touch the network: signing the request and reading the answer.
// No dependencies on purpose: the CDP SDK isn't one of ours, so a fresh clone wouldn't have it. Used by scripts/coinbase-onramp-check.mjs.
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { CANONICAL_TOKENS } from "../../server/safety.mjs";

export const API_HOST = "api.developer.coinbase.com";
export const BASE_CHAIN_ID = 8453;
export const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
export const DEFAULT_COUNTRIES = ["NL", "DE", "FR", "GR", "IE", "ES", "IT"];

const sameAddress = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * The private key as the CDP Portal gives it: a PEM (ECDSA) or 64 bytes in base64 (Ed25519, the default).
 * A PEM kept in an env file often has its line breaks written as \n, two characters, so those are put back.
 */
export function readKey(secret) {
  const text = String(secret ?? "").trim();
  if (!text) throw new Error("The API key secret is empty.");
  if (text.includes("BEGIN")) {
    const key = createPrivateKey(text.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("That PEM is not a P-256 (ECDSA) key.");
    return { key, alg: "ES256" };
  }
  const bytes = Buffer.from(text, "base64");
  if (bytes.length !== 64) throw new Error("The secret is neither a PEM key nor a base64 Ed25519 key (64 bytes).");
  const jwk = { kty: "OKP", crv: "Ed25519", d: bytes.subarray(0, 32).toString("base64url"), x: bytes.subarray(32).toString("base64url") };
  return { key: createPrivateKey({ key: jwk, format: "jwk" }), alg: "EdDSA" };
}

/** The bearer token for one request. It is only good for that method, host and path (no query string), and for two minutes. */
export function makeJwt({ keyId, secret, method = "GET", host = API_HOST, path, now = Math.floor(Date.now() / 1000), expiresIn = 120 }) {
  if (!keyId) throw new Error("The API key id is empty.");
  const { key, alg } = readKey(secret);
  const header = { alg, kid: keyId, typ: "JWT", nonce: randomBytes(16).toString("hex") };
  const claims = { sub: keyId, iss: "cdp", iat: now, nbf: now, exp: now + expiresIn, uris: [`${method} ${host}${path}`] };
  const part = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${part(header)}.${part(claims)}`;
  const signature = alg === "ES256" ? sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" }) : sign(null, Buffer.from(body), key);
  return `${body}.${signature.toString("base64url")}`;
}

/** Where a token is offered: on Base with Circle's own contract, on Base with another contract, only on other networks, or not at all. */
export function tokenOnBase(assets, symbol) {
  const matches = (assets ?? []).filter((a) => String(a.symbol).toUpperCase() === symbol);
  if (matches.length === 0) return { state: "absent" };
  const networks = matches.flatMap((a) => a.networks ?? []);
  const onBase = networks.find((n) => n.chain_id === BASE_CHAIN_ID || String(n.name).toLowerCase() === "base");
  if (!onBase) return { state: "other-networks", networks: networks.map((n) => n.name) };
  const official = CANONICAL_TOKENS[BASE_CHAIN_ID][symbol];
  const address = onBase.contract_address;
  return sameAddress(address, official) ? { state: "base", address } : { state: "base-other-address", address, expected: official };
}

const FIELDS = {
  buy: { fiat: "payment_currencies", assets: "purchase_currencies" },
  sell: { fiat: "cashout_currencies", assets: "sell_currencies" },
};

/**
 * One country in one direction. `config` is the answer of /config (all countries), `options` that of /options for this country
 * (null when the call failed, with `error` saying why). Ids the docs don't list are passed through untouched.
 */
export function summarizeCountry(code, kind, { config, options, error }) {
  const entry = (config?.countries ?? []).find((c) => c.id === code);
  const out = { code, kind, inConfig: Boolean(entry), configMethods: (entry?.payment_methods ?? []).map((m) => m.id) };
  if (!options) return { ...out, error: error ?? "no answer" };
  const eur = (options[FIELDS[kind].fiat] ?? []).find((f) => String(f.id).toUpperCase() === "EUR");
  const assets = options[FIELDS[kind].assets] ?? [];
  return { ...out, eur: Boolean(eur), eurLimits: (eur?.limits ?? []).map((l) => ({ id: l.id, min: l.min, max: l.max })), usdc: tokenOnBase(assets, "USDC"), eurc: tokenOnBase(assets, "EURC") };
}

const SEPA_LIKE = /SEPA|IBAN/i;

/** True only when the answer names SEPA itself. The documented list of payment methods has no such value, so this may stay false. */
export const mentionsSepa = (summary) => [...summary.configMethods, ...(summary.eurLimits ?? []).map((l) => l.id)].some((id) => SEPA_LIKE.test(id));

const tokenCell = (t) => ({ base: "yes", "base-other-address": "OTHER ADDRESS", "other-networks": "not on Base", absent: "no" })[t.state];

/** The table for one direction, as lines of text. */
export function renderTable(title, summaries) {
  const rows = summaries.map((s) => {
    if (s.error) return [s.code, s.inConfig ? "yes" : "no", "-", "-", "-", `ERROR: ${s.error}`];
    const limits = s.eurLimits.map((l) => `${l.id} ${l.min}-${l.max}`).join("; ") || (s.eur ? "(no limits given)" : "-");
    return [s.code, s.inConfig ? "yes" : "no", s.eur ? "yes" : "no", tokenCell(s.eurc), tokenCell(s.usdc), limits];
  });
  const head = ["country", "in config", "EUR", "EURC on Base", "USDC on Base", "EUR payment methods (min-max)"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd();
  return [title, line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)];
}

/** What the API said when it refused, in a line. */
export function describeFailure(status, body) {
  const message = typeof body === "object" && body ? body.message ?? body.error ?? JSON.stringify(body) : String(body ?? "").slice(0, 200);
  return `HTTP ${status}${message ? `: ${message}` : ""}`;
}
