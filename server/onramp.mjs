// Coinbase Onramp: buying EURC or USDC on Base into the signed-in wallet, on Coinbase's own page. The server asks Coinbase for a
// token that works once, with its own API key (which never reaches the browser), and hands back the address of the page.
import { API_HOST, describeFailure, makeJwt } from "../scripts/lib/coinbase-onramp.mjs";

export const BUY_ASSETS = ["EURC", "USDC"];
const PAY_URL = "https://pay.coinbase.com";
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * The address the request really came from. A header the caller sent isn't believed: only behind a proxy of ours (Render, with
 * TRUST_PROXY=1) is the last address it added taken. shortcut: one proxy in front. With more, take the matching entry.
 */
export function clientIpOf(req, trustProxy) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ((trustProxy && forwarded.at(-1)) || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

/** What a request to buy may ask for: one of the two assets, and optionally an amount in euros. */
export function cleanBuy(body) {
  if (!BUY_ASSETS.includes(body?.asset)) throw badRequest(`asset must be ${BUY_ASSETS.join(" or ")}`);
  if (body.fiatAmount === undefined) return { asset: body.asset };
  const fiatAmount = Number(body.fiatAmount);
  if (!(fiatAmount > 0 && fiatAmount <= 100_000)) throw badRequest("fiatAmount must be an amount in euros above 0");
  return { asset: body.asset, fiatAmount: Math.round(fiatAmount * 100) / 100 };
}

/**
 * The address of Coinbase's page for buying `asset` into `address` on Base. The money can only land at `address`, which the
 * caller takes from the signed-in session, never from the request. `baseUrl` is only moved by tests.
 */
export async function buyLink({ keyId, secret, address, ip, asset, fiatAmount, redirectUrl, baseUrl = `https://${API_HOST}`, fetchImpl = fetch }) {
  const api = new URL("/onramp/v1/token", baseUrl);
  const res = await fetchImpl(api, {
    method: "POST",
    headers: { authorization: `Bearer ${makeJwt({ keyId, secret, method: "POST", host: api.host, path: api.pathname })}`, "content-type": "application/json" },
    body: JSON.stringify({ addresses: [{ address, blockchains: ["base"] }], assets: [asset], clientIp: ip }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON, shown as text */ }
  if (!res.ok) throw Object.assign(new Error(`Coinbase said ${describeFailure(res.status, body)}`), { status: 502 });
  if (typeof body?.token !== "string") throw Object.assign(new Error("Coinbase gave no token"), { status: 502 });

  const page = new URL("/buy/select-asset", PAY_URL);
  const params = { sessionToken: body.token, defaultNetwork: "base", defaultAsset: asset, fiatCurrency: "EUR", presetFiatAmount: fiatAmount, partnerUserRef: address, redirectUrl };
  for (const [k, v] of Object.entries(params)) if (v !== undefined) page.searchParams.set(k, String(v));
  return page.toString();
}
