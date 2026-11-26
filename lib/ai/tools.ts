import "server-only";
// The AI analyst's tools. Every number the analyst quotes comes from these, which call the same
// engine as the dashboard. Outputs are compact (rounded, units in key names) to save tokens.
import { tool } from "ai";
import { z } from "zod";
import { getDataset, clampAsOf } from "@/lib/data/dataset";
import { listBets, listTasks } from "@/lib/data/management";
import { computeSnapshot, type Snapshot } from "@/engine/snapshot";
import { computeTrend, computeBreakdown, TREND_METRICS, BREAKDOWN_DIMENSIONS } from "@/engine/series";
import { runScenario } from "@/engine/scenario";
import { benchmarksFrom, betEconomics, decomposeStretch, runPlan } from "@/engine/planner";
import { runReadOnlySql, safeCalculate } from "./guards";
import { ProposedAction, describeAction } from "./action-schemas";
import { getSql } from "@/lib/db/client";

const r0 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x));
const r1 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const p1 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 1000) / 10); // fraction → pct with 1 dp

const asOfField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Snapshot date YYYY-MM-DD (end of day IST). Omit to use the user's selected date.");

async function snap(asOf: string | undefined, fallback: string) {
  const cache = await getDataset();
  const d = clampAsOf(asOf ?? fallback, cache.dataset);
  return { s: computeSnapshot(cache.dataset, d, cache.settings), cache, asOf: d, clamped: asOf !== undefined && d !== asOf };
}

function campaignRow(c: Snapshot["campaigns"][number], phase: Snapshot["phase"]) {
  return {
    id: c.campaign_id,
    name: c.campaign_name,
    channel: c.channel,
    owner: `${c.owner_name} (${c.owner_id})`,
    status: c.status,
    verdict: c.verdict.call,
    verdict_reasons: c.verdict.reasons,
    flags: c.flags,
    spend_inr: r0(c.spend),
    budget_inr: r0(c.budget_inr),
    remaining_budget_inr: r0(Math.max(0, c.budget_inr - c.spend)),
    budget_used_pct: r1(c.budget_used_pct),
    plan_window_elapsed_pct: r1(c.plan_elapsed_pct),
    identified: c.identified,
    registered: c.registered,
    confirmed: c.confirmed,
    cancelled: c.status_counts.cancelled,
    waitlisted: c.status_counts.waitlisted,
    still_interested: c.status_counts.interested,
    ...(phase !== "pre_event" ? { attended: c.attended, confirmed_no_shows: c.confirmed_no_shows, show_rate_pct: p1(c.rates.show_rate), cost_per_attendee_inr: r0(c.cost.per_attendee) } : {}),
    reg_rate_pct: p1(c.rates.reg_rate),
    confirm_rate_pct: p1(c.rates.confirm_rate),
    ctr_pct: r1(c.rates.ctr === null ? null : c.rates.ctr * 100),
    cost_per_identified_inr: r0(c.cost.per_identified),
    cost_per_confirmed_inr: r0(c.cost.per_confirmed),
    cost_vs_portfolio_pct: r0(c.verdict.ratio_pct),
    impressions_events: c.impressions,
    clicks_events: c.clicks,
  };
}

function overview(s: Snapshot) {
  return {
    as_of: s.as_of,
    phase: s.phase,
    days_to_event: s.days_to_event,
    event: "CampusFest 2025, 12–13 Apr 2025 (synthetic data)",
    active_target: s.target ? { version: s.target.target_version, identified_goal: s.target.identified_external_people_goal, registration_goal: s.target.registration_goal, visitors_goal: s.target.unique_external_visitors_goal, budget_inr: s.target.marketing_budget_inr } : null,
    target_progress: s.target_progress.map((p) => ({ metric: p.label, actual: r0(p.actual), goal: r0(p.goal), pct_of_goal: r1(p.pct_of_goal), expected_by_now_linear: r0(p.expected_by_now), on_track: p.on_track })),
    funnel: {
      anonymous_events_not_people: { impressions: s.totals.impressions, clicks: s.totals.clicks, landing_sessions: s.totals.sessions, form_starts: s.totals.registration_starts, reported_reach_summed_not_unique: s.totals.reported_reach },
      identified_external_people: s.totals.identified,
      identified_via_campaigns: s.totals.identified_via_campaign,
      registered_people: s.totals.registered,
      status_mix: s.totals.status_counts,
      ...(s.phase !== "pre_event"
        ? { verified_attendees: s.totals.attended, attended_registrants: s.totals.attended_registrants, walk_ins_unattributed: s.totals.walk_ins, no_shows: s.totals.no_shows, confirmed_no_shows: s.totals.confirmed_no_shows, attended_day1: s.totals.attended_day1, attended_day2: s.totals.attended_day2, attended_both_days: s.totals.attended_both_days }
        : {}),
    },
    spend_inr: r0(s.totals.spend),
    portfolio: { reg_rate_pct: p1(s.portfolio.reg_rate), confirm_rate_pct: p1(s.portfolio.confirm_rate), show_rate_pct: p1(s.portfolio.show_rate), cost_per_identified_inr: r0(s.portfolio.cost_per_identified), cost_per_confirmed_inr: r0(s.portfolio.cost_per_confirmed), cost_per_attendee_inr: r0(s.portfolio.cost_per_attendee) },
    bottleneck: {
      worst_stage: s.bottleneck.worst_stage,
      stages: s.bottleneck.stages.map((x) => ({ stage: x.stage, entered: x.entered, lost: x.lost, loss_pct: p1(x.loss_rate) })),
      campaigns_losing_more_than_portfolio_rate: s.bottleneck.campaign_excess_loss.map((e) => ({ campaign: `${e.campaign_name} (${e.campaign_id})`, stage: e.stage, campaign_rate_pct: p1(e.campaign_rate), portfolio_rate_pct: p1(e.portfolio_rate), excess_people_lost: e.excess_people_lost })),
    },
    projection: { basis: s.projection.basis, low: s.projection.attendees_low, mid: s.projection.attendees_mid, high: s.projection.attendees_high, visitors_goal: s.projection.visitors_goal, assumptions: s.projection.assumptions },
    verdict_summary: Object.fromEntries((["scale", "maintain", "fix", "stop", "watch"] as const).map((v) => [v, s.campaigns.filter((c) => c.verdict.call === v).map((c) => c.campaign_name)])),
    excluded_from_attendance: { non_external_admissions: s.data_notes.non_external_admissions, denied_or_pending_checkins: s.data_notes.denied_or_pending_checkins },
  };
}

export function buildTools(ctx: { asOf: string }) {
  return {
    get_overview: tool({
      description: "Portfolio snapshot: funnel, targets vs actuals and pacing, spend vs budget, unit economics, bottleneck, projection band, verdict summary. Start here for broad questions.",
      inputSchema: z.object({ as_of: asOfField }),
      execute: async ({ as_of }) => {
        const { s, clamped } = await snap(as_of, ctx.asOf);
        return { ...overview(s), ...(clamped ? { note: `Requested date outside data range; clamped to ${s.as_of}.` } : {}) };
      },
    }),

    get_campaigns: tool({
      description: "Per-campaign metrics, verdicts with reasons, owners, budget and pacing. Use for comparisons, rankings and scale/fix/stop decisions.",
      inputSchema: z.object({ as_of: asOfField, campaign_ids: z.array(z.string()).optional().describe("e.g. ['C03']; omit for all 7") }),
      execute: async ({ as_of, campaign_ids }) => {
        const { s } = await snap(as_of, ctx.asOf);
        const list = s.campaigns.filter((c) => !campaign_ids?.length || campaign_ids.includes(c.campaign_id));
        return {
          as_of: s.as_of,
          phase: s.phase,
          verdict_metric: s.phase === "post_event" ? "₹ per verified attendee vs portfolio; down-funnel = registered→attended" : "₹ per confirmed registration vs portfolio; down-funnel = registered→confirmed",
          portfolio: { cost_per_confirmed_inr: r0(s.portfolio.cost_per_confirmed), cost_per_attendee_inr: r0(s.portfolio.cost_per_attendee), confirm_rate_pct: p1(s.portfolio.confirm_rate), show_rate_pct: p1(s.portfolio.show_rate), reg_rate_pct: p1(s.portfolio.reg_rate) },
          campaigns: list.map((c) => campaignRow(c, s.phase)),
          ...(campaign_ids?.length && list.length < campaign_ids.length ? { missing_ids: campaign_ids.filter((id) => !list.some((c) => c.campaign_id === id)) } : {}),
        };
      },
    }),

    get_trend: tool({
      description: "Time series of one metric (daily or weekly) up to the as-of date, optionally for one campaign. Metrics: " + TREND_METRICS.join(", "),
      inputSchema: z.object({ metric: z.enum(TREND_METRICS), campaign_id: z.string().optional(), granularity: z.enum(["day", "week"]).optional().default("week"), from: z.string().optional().describe("YYYY-MM-DD start"), as_of: asOfField }),
      execute: async ({ metric, campaign_id, granularity, from, as_of }) => {
        const cache = await getDataset();
        const d = clampAsOf(as_of ?? ctx.asOf, cache.dataset);
        const t = computeTrend(cache.dataset, d, metric, campaign_id ?? null, granularity, from);
        const pts = t.points.length > 45 ? t.points.slice(-45) : t.points;
        return { metric, campaign_id: campaign_id ?? "all", granularity, from: t.from, to: t.to, total: t.total, note: t.note, points: pts.map((p) => [p.period, p.value, p.cumulative]), point_format: "[period_start, value, cumulative]", ...(t.points.length > 45 ? { truncated_to_last: 45 } : {}) };
      },
    }),

    compare_snapshots: tool({
      description: "What changed between two dates: per-campaign and portfolio deltas in registrations, confirmations, spend, cost per confirmed and verdict. Use for 'this week vs last week' or 'what is driving the change'.",
      inputSchema: z.object({ from_date: z.string().describe("YYYY-MM-DD earlier date"), to_date: z.string().optional().describe("YYYY-MM-DD later date; defaults to the selected date") }),
      execute: async ({ from_date, to_date }) => {
        const cache = await getDataset();
        const a = computeSnapshot(cache.dataset, clampAsOf(from_date, cache.dataset), cache.settings);
        const b = computeSnapshot(cache.dataset, clampAsOf(to_date ?? ctx.asOf, cache.dataset), cache.settings);
        return {
          from: a.as_of,
          to: b.as_of,
          portfolio: {
            registered: [a.totals.registered, b.totals.registered, b.totals.registered - a.totals.registered],
            confirmed: [a.totals.confirmed, b.totals.confirmed, b.totals.confirmed - a.totals.confirmed],
            cancelled: [a.totals.status_counts.cancelled, b.totals.status_counts.cancelled, b.totals.status_counts.cancelled - a.totals.status_counts.cancelled],
            spend_inr: [r0(a.totals.spend), r0(b.totals.spend), r0(b.totals.spend - a.totals.spend)],
            cost_per_confirmed_inr: [r0(a.portfolio.cost_per_confirmed), r0(b.portfolio.cost_per_confirmed)],
            attendees: [a.totals.attended, b.totals.attended],
            format: "[from, to, change]",
          },
          campaigns: b.campaigns.map((cb) => {
            const ca = a.campaigns.find((x) => x.campaign_id === cb.campaign_id)!;
            const newConf = cb.confirmed - ca.confirmed;
            const newSpend = cb.spend - ca.spend;
            return {
              id: cb.campaign_id,
              name: cb.campaign_name,
              new_registrations: cb.registered - ca.registered,
              net_new_confirmed: newConf,
              spend_in_period_inr: r0(newSpend),
              marginal_cost_per_net_new_confirmed_inr: newConf > 0 ? r0(newSpend / newConf) : null,
              cost_per_confirmed_inr: [r0(ca.cost.per_confirmed), r0(cb.cost.per_confirmed)],
              confirm_rate_pct: [p1(ca.rates.confirm_rate), p1(cb.rates.confirm_rate)],
              verdict: [ca.verdict.call, cb.verdict.call],
            };
          }),
        };
      },
    }),

    get_breakdown: tool({
      description: "Breakdowns: " + BREAKDOWN_DIMENSIONS.join(", ") + ". (checkin_source = scanner/manual overlap; email_funnel = nurture emails; attendance_by_day = day 1/day 2/both; registration_lead_time = days before event.)",
      inputSchema: z.object({ dimension: z.enum(BREAKDOWN_DIMENSIONS), campaign_id: z.string().optional(), as_of: asOfField }),
      execute: async ({ dimension, campaign_id, as_of }) => {
        const cache = await getDataset();
        const d = clampAsOf(as_of ?? ctx.asOf, cache.dataset);
        return { as_of: d, campaign_id: campaign_id ?? "all", ...computeBreakdown(cache.dataset, d, dimension, campaign_id ?? null) };
      },
    }),

    run_scenario: tool({
      description: "What-if: change campaign budgets (₹, positive or negative) and/or confirm-rate / show-rate (percentage points). Returns attendee impact vs baseline, gap to visitors goal, assumptions and warnings. For a budget MOVE, pass a negative change for the source and positive for the destination.",
      inputSchema: z.object({
        as_of: asOfField,
        changes: z.array(z.object({ campaign_id: z.string(), budget_change_inr: z.number().optional(), confirm_rate_change_pts: z.number().optional(), show_rate_change_pts: z.number().optional() })).min(1),
      }),
      execute: async ({ as_of, changes }) => {
        const { s, cache } = await snap(as_of, ctx.asOf);
        return runScenario(s, cache.settings, changes);
      },
    }),

    get_tasks: tool({
      description: "Tasks with owners, deadlines, status, linked campaign and bet. 'Overdue' is relative to the as-of date (campaign clock).",
      inputSchema: z.object({ status: z.enum(["todo", "doing", "blocked", "done", "open"]).optional(), owner_id: z.string().optional(), campaign_id: z.string().optional() }),
      execute: async ({ status, owner_id, campaign_id }) => {
        const tasks = await listTasks();
        const list = tasks.filter((t) => (!status || (status === "open" ? t.status !== "done" : t.status === status)) && (!owner_id || t.owner_id === owner_id) && (!campaign_id || t.campaign_id === campaign_id));
        return {
          as_of: ctx.asOf,
          count: list.length,
          tasks: list.slice(0, 40).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, owner: t.owner_name ? `${t.owner_name} (${t.owner_id})` : "unassigned", due: t.due_date, overdue: !!t.due_date && t.due_date < ctx.asOf && t.status !== "done", campaign: t.campaign_id, bet: t.bet_id, source: t.source })),
          ...(list.length > 40 ? { truncated: true } : {}),
        };
      },
    }),

    get_plan_2026: tool({
      description: "The 2026 Bengaluru plan from the strategy deck: base vs stretch attendee model by segment (2025 benchmarks × assumptions), capacity, and the five ranked bets with priority scores and scale/change/stop rules.",
      inputSchema: z.object({}),
      execute: async () => {
        const cache = await getDataset();
        const bench = benchmarksFrom(computeSnapshot(cache.dataset, cache.dataset.event.history_end, cache.settings));
        const base = runPlan("base", bench);
        const stretch = runPlan("stretch", bench);
        const bets = await listBets();
        const decomp = decomposeStretch(bench);
        const econ = new Map(betEconomics(decomp.steps, new Map(bets.map((b) => [b.bet_id, b.confidence]))).map((e) => [e.bet_id, e]));
        return {
          note: "Plan figures are assumptions built on 2025 benchmarks, not observed 2026 data.",
          base: { attendees: r0(base.totals.attendees), spend_inr: r0(base.totals.spend), cost_per_attendee_inr: r0(base.totals.cost_per_attendee) },
          stretch: { attendees: r0(stretch.totals.attendees), spend_inr: r0(stretch.totals.spend), cost_per_attendee_inr: r0(stretch.totals.cost_per_attendee) },
          capacity_ceiling: r0(base.capacity.ceiling),
          segments: base.segments.map((b, i) => ({ segment: b.name, benchmark_campaign: b.campaign_id, base_attendees: r0(b.attendees), stretch_attendees: r0(stretch.segments[i].attendees), reg_rate_pct: p1(b.reg_rate), show_rate_pct_base: p1(b.show_rate), show_rate_pct_stretch: p1(stretch.segments[i].show_rate) })),
          decomposition_order: "Pods → Flywheel → Show-up → Paid cap → Creators (sequential, to avoid double counting)",
          bets: bets.map((b) => {
            const e = econ.get(b.bet_id);
            return {
              id: b.bet_id, rank: b.rank, name: b.name, call: b.call, confidence: b.confidence,
              delta_attendees: r0(e?.delta_attendees), marginal_spend_inr: r0(e?.delta_spend), attendees_per_lakh: r0(e?.attendees_per_lakh),
              score: r0(e?.score), net_attendees_if_freed_budget_moves_to_pods: r0(e?.net_if_reinvested),
              scale_rule: b.scale_rule, change_rule: b.change_rule, stop_rule: b.stop_rule,
            };
          }),
        };
      },
    }),

    query_data: tool({
      description: "Read-only SQL (Postgres) over the analytics views for questions other tools don't cover. Single SELECT/WITH only, max 200 rows. Apply the as-of cutoff yourself with timestamps ≤ 'YYYY-MM-DD 23:59:59.999+05:30'. Remember: people metrics need person_type='external'; attendance needs is_verified_admission and distinct person_id.",
      inputSchema: z.object({ sql: z.string(), purpose: z.string().describe("One line: what this query answers") }),
      execute: async ({ sql }) => runReadOnlySql(sql),
    }),

    calculate: tool({
      description: "Evaluate arithmetic exactly (e.g. '54900/249', '(2050-1800)/1800*100', 'round(9700/2)'). Use for every calculation not already in a tool result.",
      inputSchema: z.object({ expression: z.string() }),
      execute: async ({ expression }) => ({ expression, ...safeCalculate(expression) }),
    }),

    propose_actions: tool({
      description: "Propose execution steps (create/update tasks, update a campaign's budget/status/owner/notes, move budget between campaigns). Creates PENDING proposals only; the user must click Confirm. Use real IDs from tool results.",
      inputSchema: z.object({
        actions: z.array(ProposedAction).min(1).max(6),
        rationale: z.string().describe("Why, citing the evidence numbers"),
      }),
      execute: async ({ actions, rationale }) => {
        const cache = await getDataset();
        const names = { campaigns: new Map(cache.dataset.campaigns.map((c) => [c.campaign_id, c.campaign_name])), owners: new Map(cache.dataset.owners.map((o) => [o.owner_id, o.owner_name])) };
        const errors: string[] = [];
        for (const a of actions) {
          const ids = [("campaign_id" in a ? a.campaign_id : null), ("from_campaign_id" in a ? a.from_campaign_id : null), ("to_campaign_id" in a ? a.to_campaign_id : null)].filter(Boolean) as string[];
          for (const id of ids) if (!names.campaigns.has(id)) errors.push(`Unknown campaign ${id}`);
          if ("owner_id" in a && a.owner_id && !names.owners.has(a.owner_id)) errors.push(`Unknown owner ${a.owner_id}`);
        }
        if (errors.length) return { ok: false, errors, hint: "Fix the IDs (see get_campaigns / get_tasks) and call propose_actions again." };
        const sql = getSql();
        const created: { id: number; summary: string }[] = [];
        for (const a of actions) {
          const summary = describeAction(a, names);
          const [row] = await sql`insert into app.proposed_actions (type, payload, summary, rationale) values (${a.type}, ${sql.json(a as never)}, ${summary}, ${rationale}) returning id`;
          created.push({ id: row.id, summary });
        }
        return { ok: true, status: "pending_user_confirmation", proposals: created, instruction: "Tell the user to review and click Confirm on each card. Nothing has changed yet." };
      },
    }),
  };
}
