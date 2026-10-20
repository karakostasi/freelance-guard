/**
 * Keeps the whole backend state as one JSONB document in Postgres (works with Supabase, Neon, etc).
 * Takes a pg-style pool so it can be tested without a database.
 */
export async function createPgStore(pool) {
  await pool.query(`create table if not exists app_state (
    id int primary key,
    data jsonb not null,
    updated_at timestamptz not null default now()
  )`);
  return {
    async read() {
      const { rows } = await pool.query("select data from app_state where id = 1");
      return rows[0]?.data ?? null;
    },
    async write(data) {
      await pool.query(
        `insert into app_state (id, data) values (1, $1::jsonb)
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        [JSON.stringify(data)],
      );
    },
  };
}
