// Restore a clean demo: clears tasks, AI proposals, audit log, settings overrides and usage counters,
// then reloads the original dataset (which re-seeds the starter tasks).
// Usage: npx tsx --env-file=.env.local scripts/reset-demo.ts
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { parseWorkbook } from "../lib/ingest/parse";
import { loadDatasetIntoDb } from "../lib/ingest/load-db";
import type { Sql } from "../lib/db/client";

async function main() {
  const sql = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} }) as unknown as Sql;
  await sql`truncate app.tasks, app.proposed_actions, app.audit_log, app.rate_limits, app.llm_usage restart identity`;
  await sql`delete from app.settings`;
  const ds = parseWorkbook(fs.readFileSync(path.join(__dirname, "../data/original/Attendee Dataset.xlsx")), "Attendee Dataset.xlsx");
  await loadDatasetIntoDb(sql, ds, { actor: "system", reason: "Demo reset: original 2025 dataset" });
  const [c] = await sql`select (select count(*) from app.tasks)::int tasks, (select count(*) from app.audit_log)::int audit, (select count(*) from app.proposed_actions)::int proposals`;
  console.log("clean demo state:", c);
  await (sql as unknown as { end: () => Promise<void> }).end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
