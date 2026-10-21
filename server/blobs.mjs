import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./pool.mjs";

const SHA256 = /^[0-9a-f]{64}$/;

// Blobs are addressed by their SHA-256, so a hash is the only thing that ever becomes part of a path or query.
const checked = (sha) => {
  if (!SHA256.test(sha)) throw new Error("Not a SHA-256 hash");
  return sha;
};

/** Stores file bytes as bytea in Postgres. Takes a pg-style pool so it can be tested without a database. */
export async function pgBlobStore(pool) {
  await pool.query(`create table if not exists file_blobs (
    sha256 text primary key,
    data bytea not null,
    created_at timestamptz not null default now()
  )`);
  // Supabase exposes public tables through its REST API: row level security with no policies closes that door.
  await pool.query("alter table file_blobs enable row level security");
  return {
    async put(sha, data) {
      await pool.query("insert into file_blobs (sha256, data) values ($1, $2) on conflict (sha256) do nothing", [checked(sha), data]);
    },
    async get(sha) {
      const { rows } = await pool.query("select data from file_blobs where sha256 = $1", [checked(sha)]);
      return rows[0]?.data ?? null;
    },
  };
}

/** Stores file bytes in a local folder, for development. */
export function fsBlobStore(dir) {
  mkdirSync(dir, { recursive: true });
  return {
    async put(sha, data) {
      writeFileSync(join(dir, checked(sha)), data);
    },
    async get(sha) {
      const file = join(dir, checked(sha));
      return existsSync(file) ? readFileSync(file) : null;
    },
  };
}

export async function openBlobStore() {
  const pool = await getPool();
  if (pool) return pgBlobStore(pool);
  return fsBlobStore(process.env.FILES_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "data", "files"));
}
