import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgStore } from "./pgstore.mjs";
import { explainConnectionFailure, getPool } from "./pool.mjs";

const empty = () => ({ cursor: null, runs: {}, ledger: [], notifications: [], files: {}, emails: {} });

// DATABASE_URL (Postgres, e.g. Supabase) makes the state durable across restarts and redeploys.
// Without it the state lives in a local JSON file, which is fine for development.
async function openStore() {
  const pool = await getPool();
  if (pool) {
    console.log("[db] connecting to Postgres...");
    try {
      const store = await createPgStore(pool);
      console.log("[db] using Postgres");
      return store;
    } catch (e) {
      explainConnectionFailure(e);
      process.exit(1);
    }
  }
  const file = process.env.DB_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "data", "db.json");
  console.log(`[db] using file ${file}`);
  return {
    async read() {
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    },
    async write(data) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data, null, 2));
    },
  };
}

const store = await openStore();
export const db = { ...empty(), ...(await store.read()) };

// Runs saved before the payer/payee rename carry the payee as `freelancer`.
for (const run of Object.values(db.runs)) {
  if (run.payee === undefined && run.freelancer !== undefined) {
    run.payee = run.freelancer;
    delete run.freelancer;
  }
}

let dirty = false;
let writing = false;

async function flushLoop() {
  if (writing) return;
  writing = true;
  try {
    while (dirty) {
      dirty = false;
      try {
        await store.write(db);
      } catch (e) {
        console.error("[db] write failed, retrying in 5s:", e.message);
        dirty = true;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  } finally {
    writing = false;
  }
}

/** Schedule a write. Writes are coalesced and never overlap. */
export function save() {
  dirty = true;
  flushLoop();
}

/** Wait until everything pending has been written (used on shutdown). */
export async function flush() {
  while (dirty || writing) await new Promise((r) => setTimeout(r, 50));
}
