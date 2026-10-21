// One shared Postgres pool for everything that needs the database (state and file blobs).
let pool;

/** The pool, or null when DATABASE_URL isn't set (local development uses files instead). */
export async function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

export function explainConnectionFailure(e) {
  console.error(`[db] Could not connect to Postgres (${e.code ?? e.message}).`);
  console.error("[db] Check DATABASE_URL: use the Supabase Session pooler URI, URL-encode special characters in the password (@ becomes %40),");
  console.error("[db] and make sure your network/VPN allows outbound connections on port 5432.");
}
