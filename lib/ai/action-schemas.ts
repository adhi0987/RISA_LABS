import { z } from "zod";

// Actions the AI may PROPOSE. Nothing is written until a human clicks Confirm.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const CreateTask = z.object({
  type: z.literal("create_task"),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional().default(""),
  owner_id: z.string().nullable().optional().describe("Owner ID such as T03; must exist"),
  campaign_id: z.string().nullable().optional().describe("Campaign ID such as C03"),
  bet_id: z.string().nullable().optional().describe("Bet ID B1–B5"),
  due_date: date.nullable().optional(),
  priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
});

export const UpdateTask = z.object({
  type: z.literal("update_task"),
  task_id: z.number().int(),
  status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
  owner_id: z.string().optional(),
  due_date: date.optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  title: z.string().min(3).max(200).optional(),
});

export const UpdateCampaign = z.object({
  type: z.literal("update_campaign"),
  campaign_id: z.string(),
  status: z.enum(["active", "paused", "stopped", "planned"]).optional(),
  budget_inr: z.number().min(0).optional().describe("New total budget for the campaign in INR"),
  owner_id: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export const ReallocateBudget = z.object({
  type: z.literal("reallocate_budget"),
  from_campaign_id: z.string(),
  to_campaign_id: z.string(),
  amount_inr: z.number().positive(),
});

export const ProposedAction = z.discriminatedUnion("type", [CreateTask, UpdateTask, UpdateCampaign, ReallocateBudget]);
export type ProposedAction = z.infer<typeof ProposedAction>;

export function describeAction(a: ProposedAction, names: { campaigns: Map<string, string>; owners: Map<string, string> }): string {
  const c = (id?: string | null) => (id ? `${names.campaigns.get(id) ?? id} (${id})` : "");
  const o = (id?: string | null) => (id ? names.owners.get(id) ?? id : "unassigned");
  switch (a.type) {
    case "create_task":
      return `Create task “${a.title}” for ${o(a.owner_id)}${a.due_date ? `, due ${a.due_date}` : ""}${a.campaign_id ? ` · ${c(a.campaign_id)}` : ""}`;
    case "update_task":
      return `Update task #${a.task_id}: ${Object.entries(a).filter(([k, v]) => k !== "type" && k !== "task_id" && v !== undefined).map(([k, v]) => `${k} → ${k === "owner_id" ? o(String(v)) : v}`).join(", ")}`;
    case "update_campaign":
      return `Update ${c(a.campaign_id)}: ${Object.entries(a).filter(([k, v]) => k !== "type" && k !== "campaign_id" && v !== undefined).map(([k, v]) => `${k} → ${k === "budget_inr" ? `₹${Number(v).toLocaleString("en-IN")}` : k === "owner_id" ? o(String(v)) : v}`).join(", ")}`;
    case "reallocate_budget":
      return `Move ₹${a.amount_inr.toLocaleString("en-IN")} budget from ${c(a.from_campaign_id)} to ${c(a.to_campaign_id)}`;
  }
}
