import "./env.mjs";
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, flush, save } from "./db.mjs";
import { watchEscrow, ESCROW_ADDRESS, RPC_URL } from "./chain.mjs";
import { bankReceived, createRun, fail, milestonePlan, onChainEvent, onThisContract, publicRun, subscribe } from "./pipeline.mjs";
import { EUR_PER_ETH } from "./providers.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

if (!process.env.ESCROW_ADDRESS && !process.env.VITE_ESCROW_ADDRESS) {
  console.error("Set ESCROW_ADDRESS (or VITE_ESCROW_ADDRESS) to the deployed FreelanceEscrow address.");
  process.exit(1);
}
if (!process.env.WEBHOOK_SECRET) console.warn("[warn] WEBHOOK_SECRET not set, using an insecure development secret.");

const sign = (body) => createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");

// CORS_ORIGIN: comma-separated list of allowed site origins. Empty means any origin.
// Trailing slashes are ignored, so "https://site.vercel.app/" works too.
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const corsFor = (req) => {
  const origin = req.headers.origin;
  return {
    "access-control-allow-origin": allowedOrigins.length === 0 ? "*" : allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    vary: "Origin",
    "access-control-allow-headers": "content-type, x-signature, last-event-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", ...res.cors });
  res.end(JSON.stringify(body));
};

const json = async (req) => {
  const raw = await readBody(req);
  try {
    return { raw, body: raw ? JSON.parse(raw) : {} };
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
};

const fieldError = (msg) => Object.assign(new Error(msg), { status: 400 });

function validatePayment(b) {
  if (!ADDRESS.test(b.payer ?? "")) throw fieldError("payer must be an address");
  if (!ADDRESS.test(b.freelancer ?? "")) throw fieldError("freelancer must be an address");
  if (b.payer.toLowerCase() === b.freelancer.toLowerCase()) throw fieldError("freelancer must differ from payer");
  if (!(Number(b.amount) > 0)) throw fieldError("amount must be greater than 0");
  if (b.token !== undefined && !["eth", "eurc"].includes(b.token)) throw fieldError("token must be eth or eurc");
  milestonePlan(b);
}

function stream(req, res, run) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...res.cors });
  const write = (ev) => res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
  const last = Number(req.headers["last-event-id"] ?? -1);
  run.events.filter((e) => e.seq > last).forEach(write);
  const unsubscribe = subscribe(run.id, write);
  const beat = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(beat);
    unsubscribe();
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  res.cors = corsFor(req);
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, res.cors);
      return res.end();
    }

    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true, escrow: ESCROW_ADDRESS, rpc: RPC_URL, eurPerEth: EUR_PER_ETH });

    if (req.method === "POST" && path === "/api/payments") {
      const { body } = await json(req);
      validatePayment(body);
      const run = createRun(body);
      return send(res, 201, { run: publicRun(run), bank: { iban: "DE89 3704 0044 0532 0130 00", name: "Freelance Guard (sandbox)", reference: run.ref, amountEur: run.amountEur } });
    }

    // Stand-in for the user's banking app: it triggers the same signed webhook a real bank would send.
    if (req.method === "POST" && path === "/api/sandbox/bank-transfer") {
      const { body } = await json(req);
      const run = Object.values(db.runs).find((r) => r.ref === body.reference);
      if (!run) throw Object.assign(new Error("Unknown reference"), { status: 404 });
      const payload = JSON.stringify({ reference: run.ref, amountEur: run.amountEur, iban: "DE89 3704 0044 0532 0130 00" });
      const r = await fetch(`http://127.0.0.1:${PORT}/webhooks/bank`, { method: "POST", headers: { "content-type": "application/json", "x-signature": sign(payload) }, body: payload });
      return send(res, r.status, await r.json());
    }

    if (req.method === "POST" && path === "/webhooks/bank") {
      const { raw, body } = await json(req);
      const given = Buffer.from(String(req.headers["x-signature"] ?? ""), "hex");
      const expected = Buffer.from(sign(raw), "hex");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw Object.assign(new Error("Bad signature"), { status: 401 });
      const run = Object.values(db.runs).find((r) => r.ref === body.reference);
      if (!run) throw Object.assign(new Error("Unknown reference"), { status: 404 });
      try {
        bankReceived(run, body);
      } catch (e) {
        throw Object.assign(e, { status: 409 });
      }
      return send(res, 200, { ok: true });
    }

    const payment = path.match(/^\/api\/payments\/([\w-]+)(?:\/(events|signed|cancel|route))?$/);
    if (payment) {
      const run = db.runs[payment[1]];
      if (!run) throw Object.assign(new Error("Payment not found"), { status: 404 });
      const action = payment[2];
      if (req.method === "GET" && action === "events") return stream(req, res, run);
      if (req.method === "GET" && !action) return send(res, 200, publicRun(run));
      if (req.method === "POST" && action === "signed") {
        const { body } = await json(req);
        run.gasMode = body.gasMode === "sponsored" ? "sponsored" : "wallet";
        save();
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && action === "cancel") {
        const { body } = await json(req);
        if (run.status === "awaiting_deposit") fail(run, new Error(body.reason ?? "Cancelled"));
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && action === "route") {
        const { body } = await json(req);
        if (!["sepa", "eurc"].includes(body.route)) throw fieldError("route must be sepa or eurc");
        if (["released", "paid_out", "refunded", "failed"].includes(run.status)) throw Object.assign(new Error("Payout already started"), { status: 409 });
        run.route = body.route;
        save();
        return send(res, 200, publicRun(run));
      }
    }

    if (req.method === "GET" && path === "/api/payments") {
      const payer = url.searchParams.get("payer")?.toLowerCase();
      return send(res, 200, Object.values(db.runs).filter((r) => !payer || r.payer.toLowerCase() === payer).map(publicRun));
    }

    const job = path.match(/^\/api\/jobs\/(\d+)\/run$/);
    if (req.method === "GET" && job) {
      const run = Object.values(db.runs).find((r) => onThisContract(r) && r.jobId === Number(job[1]));
      return send(res, run ? 200 : 404, run ? publicRun(run) : { error: "No payment run for this job" });
    }

    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, e.status ?? 500, { error: e.message });
  }
});

// Render and similar hosts send SIGTERM on restart: finish writing state first.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    await flush();
    process.exit(0);
  });
}

server.listen(PORT, () => {
  console.log(`Freelance Guard backend on http://localhost:${PORT}`);
  console.log(`Watching escrow ${ESCROW_ADDRESS} via ${RPC_URL}`);
  watchEscrow(onChainEvent);
});

