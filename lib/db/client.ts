import postgres from "postgres";

// One small pool per server instance, via the Supabase SESSION pooler (port 5432).
// Do NOT use the transaction pooler (6543): postgres.js pipelines queries per connection and the
// transaction pooler returned cross-wired result sets for pipelined queries in testing.
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export function getSql() {
  if (!globalForDb.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__sql = postgres(url, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      types: { numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
    });
  }
  return globalForDb.__sql;
}

/** Drop the pool (e.g. after a timeout) so the next request opens fresh connections. */
export function resetSql() {
  const old = globalForDb.__sql;
  globalForDb.__sql = undefined;
  old?.end({ timeout: 1 }).catch(() => {});
}

export type Sql = ReturnType<typeof getSql>;
