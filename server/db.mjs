import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = process.env.DB_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "data", "db.json");

const empty = () => ({ cursor: null, runs: {}, ledger: [], notifications: [] });

export const db = existsSync(file) ? { ...empty(), ...JSON.parse(readFileSync(file, "utf8")) } : empty();

export function save() {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(db, null, 2));
}
