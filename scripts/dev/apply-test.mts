// Dev check: apply pending AI proposals through the same code path as the Confirm button.
import { applyProposedAction } from "../../lib/ai/apply";
import { getSql } from "../../lib/db/client";
const sql = getSql();
const before = await sql`select campaign_id, budget_inr::float8 b from app.campaigns where campaign_id in ('C03','C04') order by 1`;
const [v0] = await sql`select (value)::text::int v from app.meta where key='data_version'`;
for (const id of [1, 2]) console.log("apply", id, JSON.stringify(await applyProposedAction(id)).slice(0, 160));
try { await applyProposedAction(1); } catch (e) { console.log("double-apply blocked:", (e as Error).message); }
const after = await sql`select campaign_id, budget_inr::float8 b from app.campaigns where campaign_id in ('C03','C04') order by 1`;
const [v1] = await sql`select (value)::text::int v from app.meta where key='data_version'`;
const task = await sql`select id, title, owner_id, due_date::text, source from app.tasks where source='ai'`;
const audit = await sql`select actor, action, entity_id from app.audit_log order by id desc limit 2`;
console.log("budgets before", before, "after", after, "version", v0.v, "→", v1.v);
console.log("ai tasks", task, "audit", audit);
await sql.end();
