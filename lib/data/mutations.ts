import "server-only";
// All writes go through here: one transaction → change + audit_log row + data_version bump.
// Used by UI server actions AND by confirmed AI proposals, so both paths behave identically.
import { getSql, type Sql } from "@/lib/db/client";
import { z } from "zod";

export type Actor = "user" | "ai (confirmed by user)" | "system";

async function audit(tx: Sql, actor: Actor, action: string, entity: string, entityId: string | null, before: unknown, after: unknown, reason = "") {
  await tx`insert into app.audit_log (actor, action, entity, entity_id, before, after, reason)
           values (${actor}, ${action}, ${entity}, ${entityId}, ${before === null || before === undefined ? null : tx.json(before as never)},
                   ${after === null || after === undefined ? null : tx.json(after as never)}, ${reason})`;
}
async function bump(tx: Sql) {
  await tx`update app.meta set value = to_jsonb((value)::text::int + 1) where key = 'data_version'`;
}
async function inTx<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  const sql = getSql();
  return (await sql.begin(async (tx) => fn(tx as unknown as Sql))) as T;
}

// ───────────── campaigns ─────────────
export const CampaignPatch = z.object({
  status: z.enum(["active", "paused", "stopped", "planned"]).optional(),
  budget_inr: z.number().min(0).max(100_000_000).optional(),
  owner_id: z.string().min(1).optional(),
  notes: z.string().max(4000).optional(),
});
export type CampaignPatch = z.infer<typeof CampaignPatch>;

export async function updateCampaign(campaignId: string, patchIn: CampaignPatch, actor: Actor, reason = "") {
  const patch = CampaignPatch.parse(patchIn);
  return inTx(async (tx) => {
    const [before] = await tx`select campaign_id, campaign_name, status, budget_inr::float8 budget_inr, owner_id, notes from app.campaigns where campaign_id = ${campaignId} for update`;
    if (!before) throw new Error(`Campaign ${campaignId} not found`);
    if (patch.owner_id) {
      const [o] = await tx`select 1 from app.owners where owner_id = ${patch.owner_id}`;
      if (!o) throw new Error(`Owner ${patch.owner_id} not found`);
    }
    const [after] = await tx`update app.campaigns set
        status = coalesce(${patch.status ?? null}, status),
        budget_inr = coalesce(${patch.budget_inr ?? null}::numeric, budget_inr),
        owner_id = coalesce(${patch.owner_id ?? null}, owner_id),
        notes = coalesce(${patch.notes ?? null}, notes),
        updated_at = now()
      where campaign_id = ${campaignId}
      returning campaign_id, campaign_name, status, budget_inr::float8 budget_inr, owner_id, notes`;
    await audit(tx, actor, "update_campaign", "campaign", campaignId, before, after, reason);
    await bump(tx);
    return after;
  });
}

export async function reallocateBudget(fromId: string, toId: string, amount: number, actor: Actor, reason = "") {
  if (!(amount > 0)) throw new Error("Amount must be positive");
  if (fromId === toId) throw new Error("Source and destination must differ");
  return inTx(async (tx) => {
    const rows = await tx`select campaign_id, campaign_name, budget_inr::float8 budget_inr from app.campaigns where campaign_id in (${fromId}, ${toId}) for update`;
    const from = rows.find((r) => r.campaign_id === fromId);
    const to = rows.find((r) => r.campaign_id === toId);
    if (!from || !to) throw new Error("Campaign not found");
    if (from.budget_inr < amount) throw new Error(`${from.campaign_name} only has ₹${from.budget_inr} budget; cannot move ₹${amount}`);
    await tx`update app.campaigns set budget_inr = budget_inr - ${amount}, updated_at = now() where campaign_id = ${fromId}`;
    await tx`update app.campaigns set budget_inr = budget_inr + ${amount}, updated_at = now() where campaign_id = ${toId}`;
    const before = { [fromId]: from.budget_inr, [toId]: to.budget_inr };
    const after = { [fromId]: from.budget_inr - amount, [toId]: to.budget_inr + amount };
    await audit(tx, actor, "reallocate_budget", "campaign", `${fromId}→${toId}`, before, after, reason);
    await bump(tx);
    return { from: from.campaign_name, to: to.campaign_name, amount, after };
  });
}

// ───────────── tasks ─────────────
export const TaskInput = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().max(4000).default(""),
  campaign_id: z.string().nullable().default(null),
  bet_id: z.string().nullable().default(null),
  owner_id: z.string().nullable().default(null),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  status: z.enum(["todo", "doing", "blocked", "done"]).default("todo"),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});
export type TaskInput = z.input<typeof TaskInput>;

export async function createTask(input: TaskInput, actor: Actor, reason = "") {
  const t = TaskInput.parse(input);
  return inTx(async (tx) => {
    const [row] = await tx`insert into app.tasks (title, description, campaign_id, bet_id, owner_id, due_date, status, priority, source)
      values (${t.title}, ${t.description}, ${t.campaign_id || null}, ${t.bet_id || null}, ${t.owner_id || null}, ${t.due_date}, ${t.status}, ${t.priority}, ${actor === "user" ? "manual" : "ai"})
      returning id, title, owner_id, due_date::text due_date, status, priority, campaign_id, bet_id`;
    await audit(tx, actor, "create_task", "task", String(row.id), null, row, reason);
    await bump(tx);
    return row;
  });
}

export async function updateTask(id: number, patchIn: Partial<z.infer<typeof TaskInput>>, actor: Actor, reason = "") {
  const patch = TaskInput.partial().parse(patchIn);
  return inTx(async (tx) => {
    const [before] = await tx`select id, title, description, campaign_id, bet_id, owner_id, due_date::text due_date, status, priority from app.tasks where id = ${id} for update`;
    if (!before) throw new Error(`Task ${id} not found`);
    const next = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    const [after] = await tx`update app.tasks set title = ${next.title}, description = ${next.description}, campaign_id = ${next.campaign_id || null},
        bet_id = ${next.bet_id || null}, owner_id = ${next.owner_id || null}, due_date = ${next.due_date || null}, status = ${next.status},
        priority = ${next.priority}, updated_at = now() where id = ${id}
      returning id, title, description, campaign_id, bet_id, owner_id, due_date::text due_date, status, priority`;
    await audit(tx, actor, "update_task", "task", String(id), before, after, reason);
    await bump(tx);
    return after;
  });
}

export async function deleteTask(id: number, actor: Actor) {
  return inTx(async (tx) => {
    const [before] = await tx`delete from app.tasks where id = ${id} returning id, title, owner_id, status`;
    if (!before) throw new Error(`Task ${id} not found`);
    await audit(tx, actor, "delete_task", "task", String(id), before, null);
    await bump(tx);
  });
}

// ───────────── source data edits ─────────────
export const DailyPatch = z.object({
  impressions: z.number().int().min(0).optional(),
  clicks: z.number().int().min(0).optional(),
  reported_reach: z.number().int().min(0).optional(),
  landing_page_sessions: z.number().int().min(0).optional(),
  registration_starts: z.number().int().min(0).optional(),
  marketing_spend_inr: z.number().min(-10_000_000).max(10_000_000).optional(),
});

export async function updateDaily(activityId: string, patchIn: z.infer<typeof DailyPatch>, actor: Actor) {
  const p = DailyPatch.parse(patchIn);
  return inTx(async (tx) => {
    const [before] = await tx`select activity_id, campaign_id, activity_date::text activity_date, impressions, clicks, reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr::float8 marketing_spend_inr from app.daily_marketing where activity_id = ${activityId} for update`;
    if (!before) throw new Error(`Daily row ${activityId} not found`);
    const [after] = await tx`update app.daily_marketing set
        impressions = coalesce(${p.impressions ?? null}::int, impressions), clicks = coalesce(${p.clicks ?? null}::int, clicks),
        reported_reach = coalesce(${p.reported_reach ?? null}::int, reported_reach), landing_page_sessions = coalesce(${p.landing_page_sessions ?? null}::int, landing_page_sessions),
        registration_starts = coalesce(${p.registration_starts ?? null}::int, registration_starts),
        marketing_spend_inr = coalesce(${p.marketing_spend_inr ?? null}::numeric, marketing_spend_inr), origin = 'user'
      where activity_id = ${activityId}
      returning activity_id, campaign_id, activity_date::text activity_date, impressions, clicks, reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr::float8 marketing_spend_inr`;
    await audit(tx, actor, "edit_daily_marketing", "daily_marketing", activityId, before, after);
    await bump(tx);
    return after;
  });
}

export async function addDaily(input: { campaign_id: string; activity_date: string } & z.infer<typeof DailyPatch>, actor: Actor) {
  const p = DailyPatch.parse(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.activity_date)) throw new Error("activity_date must be YYYY-MM-DD");
  return inTx(async (tx) => {
    const [c] = await tx`select owner_id from app.campaigns where campaign_id = ${input.campaign_id}`;
    if (!c) throw new Error(`Campaign ${input.campaign_id} not found`);
    const id = `AD-USER-${Date.now().toString(36).toUpperCase()}`;
    const [row] = await tx`insert into app.daily_marketing (activity_id, campaign_id, owner_id, activity_date, impressions, clicks, reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr, platform, origin)
      values (${id}, ${input.campaign_id}, ${c.owner_id}, ${input.activity_date}, ${p.impressions ?? 0}, ${p.clicks ?? 0}, ${p.reported_reach ?? 0}, ${p.landing_page_sessions ?? 0}, ${p.registration_starts ?? 0}, ${p.marketing_spend_inr ?? 0}, 'manual entry', 'user')
      returning activity_id, campaign_id, activity_date::text activity_date, marketing_spend_inr::float8 marketing_spend_inr`;
    await audit(tx, actor, "add_daily_marketing", "daily_marketing", id, null, row);
    await bump(tx);
    return row;
  });
}

export async function appendRegistrationStatus(registrationId: string, status: "interested" | "confirmed" | "cancelled" | "waitlisted", effectiveAtIso: string, actor: Actor) {
  return inTx(async (tx) => {
    const [reg] = await tx`select registration_id, person_id, campaign_id, owner_id from app.registrations where registration_id = ${registrationId}`;
    if (!reg) throw new Error(`Registration ${registrationId} not found`);
    const [prev] = await tx`select status, effective_at from app.registration_history where registration_id = ${registrationId} order by effective_at desc limit 1`;
    const id = `RH-USER-${Date.now().toString(36).toUpperCase()}`;
    const [row] = await tx`insert into app.registration_history (history_id, registration_id, person_id, campaign_id, owner_id, effective_at, status, origin)
      values (${id}, ${registrationId}, ${reg.person_id}, ${reg.campaign_id}, ${reg.owner_id}, ${effectiveAtIso}, ${status}, 'user')
      returning history_id, registration_id, effective_at, status`;
    await audit(tx, actor, "append_registration_status", "registration", registrationId, prev ?? null, row);
    await bump(tx);
    return row;
  });
}

export const TargetInput = z.object({
  effective_at: z.string(),
  identified_external_people_goal: z.number().int().min(0),
  registration_goal: z.number().int().min(0),
  unique_external_visitors_goal: z.number().int().min(0),
  marketing_budget_inr: z.number().min(0),
  target_version: z.string().trim().min(2).max(120),
});

export async function addTargetVersion(input: z.infer<typeof TargetInput>, actor: Actor) {
  const t = TargetInput.parse(input);
  return inTx(async (tx) => {
    const [row] = await tx`insert into app.targets (effective_at, identified_external_people_goal, registration_goal, unique_external_visitors_goal, marketing_budget_inr, target_version, origin)
      values (${t.effective_at}, ${t.identified_external_people_goal}, ${t.registration_goal}, ${t.unique_external_visitors_goal}, ${t.marketing_budget_inr}, ${t.target_version}, 'user')
      returning id, effective_at, target_version`;
    await audit(tx, actor, "add_target_version", "targets", String(row.id), null, { ...t });
    await bump(tx);
    return row;
  });
}

export async function deleteUserTarget(id: number, actor: Actor) {
  return inTx(async (tx) => {
    const [before] = await tx`delete from app.targets where id = ${id} and origin = 'user' returning id, target_version`;
    if (!before) throw new Error("Only targets added in the app can be deleted");
    await audit(tx, actor, "delete_target_version", "targets", String(id), before, null);
    await bump(tx);
  });
}

export async function saveEngineSettings(value: unknown, actor: Actor) {
  return inTx(async (tx) => {
    const [before] = await tx`select value from app.settings where key = 'engine'`;
    await tx`insert into app.settings (key, value, updated_at) values ('engine', ${tx.json(value as never)}, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await audit(tx, actor, "update_settings", "settings", "engine", before?.value ?? null, value);
    await bump(tx);
  });
}
