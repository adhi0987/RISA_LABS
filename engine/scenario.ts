// What-if scenarios on top of a snapshot. Transparent, simple, assumption-labelled.
import type { Snapshot } from "./snapshot";
import type { Settings } from "./types";

export type ScenarioChange = {
  campaign_id: string;
  budget_change_inr?: number; // + adds spend, − removes spend (applied to the remaining period)
  confirm_rate_change_pts?: number; // e.g. +5 → registered→confirmed rate +5 pts
  show_rate_change_pts?: number; // e.g. +8 → confirmed→attended +8 pts
};

export type ScenarioResult = {
  as_of: string;
  basis: "pre_event_projection" | "post_event_counterfactual";
  per_campaign: {
    campaign_id: string;
    campaign_name: string;
    budget_change_inr: number;
    cost_per_confirmed_now: number | null;
    baseline_confirmed: number;
    scenario_confirmed: number;
    baseline_attendees: number;
    scenario_attendees: number;
    delta_attendees: number;
    remaining_budget_inr: number;
  }[];
  totals: { baseline_attendees: number; scenario_attendees: number; delta_attendees: number; net_budget_change_inr: number; visitors_goal: number | null; scenario_gap_to_goal: number | null };
  assumptions: string[];
  warnings: string[];
};

export const MARGINAL_EFFICIENCY = 0.8; // extra spend converts at 80% of the campaign's average efficiency

export function runScenario(s: Snapshot, settings: Settings, changes: ScenarioChange[]): ScenarioResult {
  const post = s.phase === "post_event";
  const warnings: string[] = [];
  const byId = new Map(s.campaigns.map((c) => [c.campaign_id, c]));
  for (const ch of changes) if (!byId.has(ch.campaign_id)) warnings.push(`Unknown campaign ${ch.campaign_id}; ignored.`);

  // Baseline attendee rate per confirmed: post-event = observed campaign show rate on confirmed; pre-event = assumed band mid.
  const showOfConfirmed = (c: Snapshot["campaigns"][number]) => (post ? (c.confirmed > 0 ? c.attended / Math.max(c.confirmed, 1) : 0) : settings.showRateBand.mid);

  const per = s.campaigns.map((c) => {
    const ch = changes.find((x) => x.campaign_id === c.campaign_id);
    const cpc = c.cost.per_confirmed;
    const budgetChange = ch?.budget_change_inr ?? 0;
    const remaining = Math.max(0, c.budget_inr - c.spend);
    let deltaConfirmed = 0;
    if (budgetChange !== 0 && cpc && cpc > 0) {
      deltaConfirmed = budgetChange > 0 ? (budgetChange / cpc) * MARGINAL_EFFICIENCY : budgetChange / cpc;
    } else if (budgetChange !== 0) {
      warnings.push(`${c.campaign_name} has no confirmed registrations to price spend against; budget change has no modelled effect.`);
    }
    if (budgetChange < 0 && -budgetChange > remaining && !post) {
      warnings.push(`${c.campaign_name}: cutting ₹${Math.round(-budgetChange).toLocaleString("en-IN")} exceeds its remaining budget of ₹${Math.round(remaining).toLocaleString("en-IN")}.`);
    }
    const confirmLift = (ch?.confirm_rate_change_pts ?? 0) / 100;
    const scenarioConfirmed = Math.max(0, c.confirmed + deltaConfirmed + confirmLift * c.registered);
    const rate = Math.min(1, Math.max(0, showOfConfirmed(c) + (ch?.show_rate_change_pts ?? 0) / 100));
    const baseline = post ? c.attended : c.confirmed * showOfConfirmed(c);
    const scenario = scenarioConfirmed * rate;
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      budget_change_inr: budgetChange,
      cost_per_confirmed_now: cpc,
      baseline_confirmed: c.confirmed,
      scenario_confirmed: Math.round(scenarioConfirmed),
      baseline_attendees: Math.round(baseline),
      scenario_attendees: Math.round(scenario),
      delta_attendees: Math.round(scenario - baseline),
      remaining_budget_inr: Math.round(remaining),
    };
  });

  const changed = per.filter((p) => changes.some((c) => c.campaign_id === p.campaign_id));
  const baselineAtt = per.reduce((a, p) => a + p.baseline_attendees, 0);
  const scenarioAtt = per.reduce((a, p) => a + p.scenario_attendees, 0);
  const walkIns = post ? s.totals.walk_ins : Math.round(baselineAtt * settings.walkInShare);
  const goal = s.target?.unique_external_visitors_goal ?? null;
  const total = scenarioAtt + walkIns;
  return {
    as_of: s.as_of,
    basis: post ? "post_event_counterfactual" : "pre_event_projection",
    per_campaign: changed,
    totals: {
      baseline_attendees: baselineAtt + walkIns,
      scenario_attendees: total,
      delta_attendees: scenarioAtt - baselineAtt,
      net_budget_change_inr: changes.reduce((a, c) => a + (c.budget_change_inr ?? 0), 0),
      visitors_goal: goal,
      scenario_gap_to_goal: goal === null ? null : total - goal,
    },
    assumptions: [
      `Added spend converts at ${Math.round(MARGINAL_EFFICIENCY * 100)}% of the campaign's current ₹ per confirmed (diminishing returns); removed spend loses confirmations at the current average rate.`,
      post
        ? "Post-event: counterfactual using each campaign's observed attended ÷ confirmed ratio."
        : `Pre-event: confirmed → attended at the assumed mid show-rate (${Math.round(settings.showRateBand.mid * 100)}%), walk-ins +${(settings.walkInShare * 100).toFixed(1)}%.`,
      "Baseline counts only what is confirmed as of the snapshot (no run-rate growth), so deltas isolate the change itself.",
      "Rate changes are applied to the campaign's current registered base. Effects are not causal estimates.",
    ],
    warnings,
  };
}
