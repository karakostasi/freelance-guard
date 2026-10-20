import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgStore } from "./pgstore.mjs";

const empty = () => ({ cursor: null, runs: {}, ledger: [], notifications: [] });

// DATABASE_URL (Postgres, e.g. Supabase) makes the state durable across restarts and redeploys.
// Without it the state lives in a local JSON file, which is fine for development.
async function openStore() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 10000,
    });
    console.log("[db] connecting to Postgres...");
    try {
      const store = await createPgStore(pool);
      console.log("[db] using Postgres");
      return store;
    } catch (e) {
      console.error(`[db] Could not connect to Postgres (${e.code ?? e.message}).`);
      console.error("[db] Check DATABASE_URL: use the Supabase Session pooler URI, URL-encode special characters in the password (@ becomes %40),");
      console.error("[db] and make sure your network/VPN allows outbound connections on port 5432.");
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
