// One-time / repeatable DB setup: apply schema, then load the original dataset.
// Usage: npx tsx --env-file=.env.local scripts/setup-db.ts
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { parseWorkbook } from "../lib/ingest/parse";
import { loadDatasetIntoDb } from "../lib/ingest/load-db";
import type { Sql } from "../lib/db/client";

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL / DATABASE_URL missing");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} }) as unknown as Sql;
  const t0 = Date.now();
  await sql.unsafe(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  console.log(`schema applied (${Date.now() - t0}ms)`);

  const file = path.join(__dirname, "../data/original/Attendee Dataset.xlsx");
  const ds = parseWorkbook(fs.readFileSync(file), "Attendee Dataset.xlsx");
  console.log("parsed:", ds.health.tables.map((t) => `${t.table}=${t.keptRows} (-${t.importCopiesRemoved})`).join(", "));
  const t1 = Date.now();
  await loadDatasetIntoDb(sql, ds, { actor: "system", reason: "Initial load of the original 2025 dataset" });
  console.log(`loaded (${Date.now() - t1}ms)`);

  const counts = await sql`select
    (select count(*) from app.people)::int people, (select count(*) from app.registrations)::int regs,
    (select count(*) from app.registration_history)::int hist, (select count(*) from app.checkins)::int checkins,
    (select count(*) from app.daily_marketing)::int daily, (select sum(marketing_spend_inr) from app.daily_marketing)::float spend,
    (select count(*) from app.tasks)::int tasks, (select count(*) from app.bets)::int bets,
    (select value from app.meta where key='data_version') version`;
  console.log(counts[0]);
  await (sql as unknown as { end: () => Promise<void> }).end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
