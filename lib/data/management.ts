import "server-only";
import { getSql } from "@/lib/db/client";

export type TaskRow = {
  id: number;
  title: string;
  description: string;
  campaign_id: string | null;
  campaign_name: string | null;
  bet_id: string | null;
  bet_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  status: "todo" | "doing" | "blocked" | "done";
  priority: "high" | "medium" | "low";
  source: "manual" | "ai" | "seed";
  created_at: string;
  updated_at: string;
};

export async function listTasks(filter: { campaignId?: string } = {}): Promise<TaskRow[]> {
  const sql = getSql();
  const rows = await sql<TaskRow[]>`
    select t.id, t.title, t.description, t.campaign_id, c.campaign_name, t.bet_id, b.name as bet_name, t.owner_id, o.owner_name,
           t.due_date::text as due_date, t.status, t.priority, t.source, t.created_at::text as created_at, t.updated_at::text as updated_at
    from app.tasks t
    left join app.campaigns c on c.campaign_id = t.campaign_id
    left join app.bets b on b.bet_id = t.bet_id
    left join app.owners o on o.owner_id = t.owner_id
    where (${filter.campaignId ?? null}::text is null or t.campaign_id = ${filter.campaignId ?? null})
    order by case t.status when 'blocked' then 0 when 'doing' then 1 when 'todo' then 2 else 3 end,
             case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, t.due_date nulls last, t.id`;
  return rows;
}

export type BetRowDb = {
  bet_id: string; rank: number; name: string; call: string; concept: string; incremental_attendees: number; budget_inr: number;
  confidence: number; kpis: string; scale_rule: string; change_rule: string; stop_rule: string;
};

export async function listBets(): Promise<BetRowDb[]> {
  const sql = getSql();
  return sql<BetRowDb[]>`select bet_id, rank, name, call, concept, incremental_attendees, budget_inr::float8 budget_inr, confidence::float8 confidence,
                                kpis, scale_rule, change_rule, stop_rule from app.bets order by rank`;
}

export type AuditRow = { id: number; at: string; actor: string; action: string; entity: string; entity_id: string | null; before: unknown; after: unknown; reason: string };
export async function listAudit(limit = 200): Promise<AuditRow[]> {
  const sql = getSql();
  return sql<AuditRow[]>`select id, at::text at, actor, action, entity, entity_id, before, after, reason from app.audit_log order by id desc limit ${limit}`;
}

export type ProposalRow = { id: number; type: string; payload: unknown; summary: string; rationale: string; evidence: string; status: string; result: unknown; created_at: string; decided_at: string | null };
export async function listProposals(ids?: number[]): Promise<ProposalRow[]> {
  const sql = getSql();
  if (ids && ids.length === 0) return [];
  return ids
    ? sql<ProposalRow[]>`select id, type, payload, summary, rationale, evidence, status, result, created_at::text created_at, decided_at::text decided_at from app.proposed_actions where id = any(${ids}) order by id`
    : sql<ProposalRow[]>`select id, type, payload, summary, rationale, evidence, status, result, created_at::text created_at, decided_at::text decided_at from app.proposed_actions order by id desc limit 100`;
}

export async function getHealth() {
  const sql = getSql();
  const [row] = await sql`select value from app.meta where key = 'health'`;
  return (row?.value ?? null) as null | { parsedAt: string; fileName: string; tables: { table: string; sourceRows: number; importCopiesRemoved: number; conflictingDuplicates: number; keptRows: number }[]; notes: string[] };
}
