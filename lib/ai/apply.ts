import "server-only";
// Apply / reject AI-proposed actions. Only called from a user click (server action).
import { getSql } from "@/lib/db/client";
import { ProposedAction } from "./action-schemas";
import { createTask, reallocateBudget, updateCampaign, updateTask } from "@/lib/data/mutations";

const ACTOR = "ai (confirmed by user)" as const;

export async function applyProposedAction(id: number) {
  const sql = getSql();
  // Claim the row atomically so a double click can't apply twice.
  const [row] = await sql`update app.proposed_actions set status = 'applied', decided_at = now()
                          where id = ${id} and status = 'pending' returning id, payload, rationale`;
  if (!row) throw new Error("This proposal was already handled.");
  try {
    const action = ProposedAction.parse(row.payload);
    const reason = `AI proposal #${id}: ${row.rationale}`.slice(0, 1000);
    let result: unknown;
    switch (action.type) {
      case "create_task":
        result = await createTask(
          { title: action.title, description: action.description ?? "", owner_id: action.owner_id ?? null, campaign_id: action.campaign_id ?? null, bet_id: action.bet_id ?? null, due_date: action.due_date ?? null, priority: action.priority ?? "medium" },
          ACTOR, reason,
        );
        break;
      case "update_task": {
        const { type: _t, task_id, ...patch } = action;
        result = await updateTask(task_id, patch, ACTOR, reason);
        break;
      }
      case "update_campaign": {
        const { type: _t, campaign_id, ...patch } = action;
        result = await updateCampaign(campaign_id, patch, ACTOR, reason);
        break;
      }
      case "reallocate_budget":
        result = await reallocateBudget(action.from_campaign_id, action.to_campaign_id, action.amount_inr, ACTOR, reason);
        break;
    }
    await sql`update app.proposed_actions set result = ${sql.json(result as never)} where id = ${id}`;
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`update app.proposed_actions set status = 'failed', result = ${sql.json({ error: msg })} where id = ${id}`;
    throw e;
  }
}

export async function rejectProposedAction(id: number) {
  const sql = getSql();
  const [row] = await sql`update app.proposed_actions set status = 'rejected', decided_at = now() where id = ${id} and status = 'pending' returning id, summary`;
  if (!row) throw new Error("This proposal was already handled.");
  await sql`insert into app.audit_log (actor, action, entity, entity_id, reason) values ('user', 'reject_ai_proposal', 'proposed_action', ${String(id)}, ${row.summary})`;
}
