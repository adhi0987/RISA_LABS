// 2026 Planner: reproduces Slide 1 (segments → funnel → attendees, base vs stretch) and Slide 2 (bet ranking).
// Conversion rates and cost-per-identified come LIVE from the dataset's final snapshot by channel,
// so if the 2025 data changes, the plan re-bases automatically.
import type { Snapshot } from "./snapshot";

export type Scenario = "base" | "stretch";

export type SegmentInputs = {
  id: string;
  name: string;
  why: string;
  campaign_id: string; // 2025 benchmark channel
  driver: "count" | "referral_k" | "fixed" | "spend";
  // driver params per scenario
  base: DriverParams;
  stretch: DriverParams;
  show_uplift_pts_stretch: number; // Show-Up Engineering uplift applied in stretch
  extra_cost_per_attendee_stretch?: number; // e.g. referral reward ₹40 per referred attendee
};

export type DriverParams = {
  units?: number; // colleges / ambassadors / groups
  pool_per_unit?: number; // students per college, peers per ambassador, members per group
  penetration?: number; // share of pool that becomes identified interest
  k?: number; // referral identified per non-referral registrant
  identified?: number; // fixed identified
  spend?: number; // spend-driven channels
};

export type PlannerAssumptions = {
  inflation: number; // Bengaluru cost inflation on 2025 cost per identified
  walk_in_share: number; // walk-ins as share of campaign attendees
  programme_costs_stretch: number; // pod prizes + show-up stack
  capacity_per_day: number;
  two_day_share: number;
  event_days: number;
};

export const DEFAULT_PLANNER_ASSUMPTIONS: PlannerAssumptions = {
  inflation: 1.15,
  walk_in_share: 0.065,
  programme_costs_stretch: 85000,
  capacity_per_day: 6000,
  two_day_share: 0.3536,
  event_days: 2,
};

export const DEFAULT_SEGMENTS: SegmentInputs[] = [
  { id: "colleges", name: "Partner colleges", why: "2025: 90% register, 86% attend", campaign_id: "C04", driver: "count", base: { units: 40, pool_per_unit: 1200, penetration: 0.025 }, stretch: { units: 70, pool_per_unit: 1200, penetration: 0.03 }, show_uplift_pts_stretch: 3 },
  { id: "referrals", name: "Squad referrals", why: "cheapest 2025 channel (₹69)", campaign_id: "C05", driver: "referral_k", base: { k: 0.17167 }, stretch: { k: 0.3 }, show_uplift_pts_stretch: 5, extra_cost_per_attendee_stretch: 40 },
  { id: "ambassadors", name: "Campus ambassadors", why: "peer trust", campaign_id: "C01", driver: "count", base: { units: 100, pool_per_unit: 250, penetration: 0.03 }, stretch: { units: 160, pool_per_unit: 250, penetration: 0.03 }, show_uplift_pts_stretch: 6 },
  { id: "clubs", name: "Clubs & communities", why: "music, tech, gaming groups", campaign_id: "C07", driver: "count", base: { units: 25, pool_per_unit: 600, penetration: 0.03 }, stretch: { units: 40, pool_per_unit: 600, penetration: 0.03 }, show_uplift_pts_stretch: 4 },
  { id: "search", name: "High-intent search", why: "already looking", campaign_id: "C06", driver: "fixed", base: { identified: 580 }, stretch: { identified: 580 }, show_uplift_pts_stretch: 5 },
  { id: "paid", name: "Paid social", why: "scale, weak show-rate", campaign_id: "C02", driver: "spend", base: { spend: 110000 }, stretch: { spend: 80000 }, show_uplift_pts_stretch: 12 },
  { id: "creators", name: "Creators", why: "reach without intent", campaign_id: "C03", driver: "spend", base: { spend: 40000 }, stretch: { spend: 25000 }, show_uplift_pts_stretch: 12 },
];

export type SegmentResult = {
  id: string;
  name: string;
  campaign_id: string;
  driver_label: string;
  identified: number;
  reg_rate: number;
  show_rate: number;
  registered: number;
  attendees: number;
  spend: number;
  cost_per_identified_2025: number;
};

export type PlanResult = {
  scenario: Scenario;
  segments: SegmentResult[];
  walk_ins: number;
  programme_costs: number;
  totals: { identified: number; registered: number; attendees: number; spend: number; cost_per_attendee: number; reg_rate: number; show_rate: number };
  capacity: { ceiling: number; utilisation: number };
};

type Bench = { reg_rate: number; show_rate: number; cost_per_identified: number };

export function benchmarksFrom(final: Snapshot): Map<string, Bench> {
  const m = new Map<string, Bench>();
  for (const c of final.campaigns) {
    m.set(c.campaign_id, {
      reg_rate: c.rates.reg_rate ?? 0,
      show_rate: c.rates.show_rate ?? 0,
      cost_per_identified: c.cost.per_identified ?? 0,
    });
  }
  return m;
}

/** One segment with its parameters fully resolved (lets the decomposition mix base and stretch settings). */
type Resolved = { seg: SegmentInputs; params: DriverParams; upliftPts: number; extraCostPerAttendee: number };

function resolveScenario(scenario: Scenario, segments: SegmentInputs[]): Resolved[] {
  return segments.map((seg) => ({
    seg,
    params: seg[scenario],
    upliftPts: scenario === "stretch" ? seg.show_uplift_pts_stretch : 0,
    extraCostPerAttendee: scenario === "stretch" ? seg.extra_cost_per_attendee_stretch ?? 0 : 0,
  }));
}

export function runPlan(scenario: Scenario, bench: Map<string, Bench>, segments = DEFAULT_SEGMENTS, a = DEFAULT_PLANNER_ASSUMPTIONS): PlanResult {
  return runResolved(scenario, resolveScenario(scenario, segments), bench, a, scenario === "stretch" ? a.programme_costs_stretch : 0);
}

function runResolved(scenario: Scenario, resolved: Resolved[], bench: Map<string, Bench>, a: PlannerAssumptions, programme: number): PlanResult {
  const benchOf = (seg: SegmentInputs) => bench.get(seg.campaign_id) ?? { reg_rate: 0, show_rate: 0, cost_per_identified: 0 };
  const results: SegmentResult[] = resolved.filter((r) => r.seg.driver !== "referral_k").map((r) => compute(r, benchOf(r.seg), a, 0));
  // Referral identified = k × registrants from all other segments.
  const otherRegistered = results.reduce((s, r) => s + r.registered, 0);
  for (const r of resolved.filter((x) => x.seg.driver === "referral_k")) results.push(compute(r, benchOf(r.seg), a, otherRegistered));
  results.sort((x, y) => resolved.findIndex((r) => r.seg.id === x.id) - resolved.findIndex((r) => r.seg.id === y.id));

  const campaignAttendees = results.reduce((s, r) => s + r.attendees, 0);
  const walkIns = campaignAttendees * a.walk_in_share;
  const identified = results.reduce((s, r) => s + r.identified, 0);
  const registered = results.reduce((s, r) => s + r.registered, 0);
  const attendees = campaignAttendees + walkIns;
  const spend = results.reduce((s, r) => s + r.spend, 0) + programme;
  const ceiling = (a.capacity_per_day * a.event_days) / (1 + a.two_day_share);
  return {
    scenario,
    segments: results,
    walk_ins: walkIns,
    programme_costs: programme,
    totals: { identified, registered, attendees, spend, cost_per_attendee: attendees ? spend / attendees : 0, reg_rate: identified ? registered / identified : 0, show_rate: registered ? campaignAttendees / registered : 0 },
    capacity: { ceiling, utilisation: ceiling ? attendees / ceiling : 0 },
  };
}

function compute(r: Resolved, b: Bench, a: PlannerAssumptions, otherRegistered: number): SegmentResult {
  const { seg, params: p } = r;
  const cpi = b.cost_per_identified * a.inflation;
  let identified = 0;
  let label = "";
  switch (seg.driver) {
    case "count":
      identified = (p.units ?? 0) * (p.pool_per_unit ?? 0) * (p.penetration ?? 0);
      label = `${p.units} × ${p.pool_per_unit?.toLocaleString("en-IN")} × ${((p.penetration ?? 0) * 100).toFixed(1)}%`;
      break;
    case "referral_k":
      identified = (p.k ?? 0) * otherRegistered;
      label = `k = ${(p.k ?? 0).toFixed(2)} per registrant`;
      break;
    case "fixed":
      identified = p.identified ?? 0;
      label = `${p.identified} identified`;
      break;
    case "spend":
      identified = cpi > 0 ? (p.spend ?? 0) / cpi : 0;
      label = `₹${((p.spend ?? 0) / 1000).toFixed(0)}k spend`;
      break;
  }
  const regRate = b.reg_rate;
  const showRate = Math.min(1, b.show_rate + r.upliftPts / 100);
  const registered = identified * regRate;
  const attendees = registered * showRate;
  const spend = (seg.driver === "spend" ? p.spend ?? 0 : identified * cpi) + attendees * r.extraCostPerAttendee;
  return { id: seg.id, name: seg.name, campaign_id: seg.campaign_id, driver_label: label, identified, reg_rate: regRate, show_rate: showRate, registered, attendees, spend, cost_per_identified_2025: b.cost_per_identified };
}

export type DecompositionStep = { bet_id: string; label: string; attendees_after: number; delta_attendees: number; delta_spend: number };

/**
 * Sequential decomposition of base → stretch into the five bets (Slide 2's waterfall).
 * Order matters because effects overlap: referrals scale with other segments' registrants,
 * and show-up uplift multiplies every channel, so it is applied after the reach bets.
 */
export function decomposeStretch(bench: Map<string, Bench>, segments = DEFAULT_SEGMENTS, a = DEFAULT_PLANNER_ASSUMPTIONS): { base: number; stretch: number; steps: DecompositionStep[] } {
  const state = resolveScenario("base", segments);
  const byId = (id: string) => state.find((r) => r.seg.id === id)!;
  const toStretch = (id: string) => {
    const r = byId(id);
    if (r) r.params = r.seg.stretch;
  };
  let programme = 0;
  const POD_PRIZES = 40000;
  const SHOW_UP_STACK = a.programme_costs_stretch - POD_PRIZES;
  const plan: { bet_id: string; label: string; apply: () => void }[] = [
    { bet_id: "B1", label: "College Pods", apply: () => { toStretch("colleges"); toStretch("clubs"); programme += POD_PRIZES; } },
    { bet_id: "B3", label: "Ambassador + referral flywheel", apply: () => { toStretch("ambassadors"); toStretch("referrals"); const r = byId("referrals"); r.extraCostPerAttendee = r.seg.extra_cost_per_attendee_stretch ?? 0; } },
    { bet_id: "B2", label: "Show-Up Engineering", apply: () => { for (const r of state) r.upliftPts = r.seg.show_uplift_pts_stretch; programme += SHOW_UP_STACK; } },
    { bet_id: "B4", label: "Paid social → retargeting", apply: () => toStretch("paid") },
    { bet_id: "B5", label: "Creators pay-per-attendee", apply: () => toStretch("creators") },
  ];
  let prev = runResolved("base", state, bench, a, programme);
  const base = prev.totals.attendees;
  const steps: DecompositionStep[] = [];
  for (const step of plan) {
    step.apply();
    const next = runResolved("stretch", state, bench, a, programme);
    steps.push({ bet_id: step.bet_id, label: step.label, attendees_after: next.totals.attendees, delta_attendees: next.totals.attendees - prev.totals.attendees, delta_spend: next.totals.spend - prev.totals.spend });
    prev = next;
  }
  return { base, stretch: prev.totals.attendees, steps };
}

export type BetEconomics = {
  bet_id: string;
  delta_attendees: number;
  delta_spend: number;
  attendees_per_lakh: number | null;
  score: number | null; // Δattendees × confidence ÷ Δspend (₹ lakh), for bets that add spend
  net_if_reinvested: number | null; // for cuts: attendees regained by moving the freed budget into the most efficient bet, minus attendees lost
};

/** Slide 2 economics computed from the live decomposition. */
export function betEconomics(steps: DecompositionStep[], confidence: Map<string, number>): BetEconomics[] {
  const perLakh = (s: DecompositionStep) => (s.delta_spend !== 0 ? Math.abs(s.delta_attendees) / (Math.abs(s.delta_spend) / 100000) : null);
  const best = Math.max(...steps.filter((s) => s.delta_spend > 0).map((s) => perLakh(s) ?? 0));
  return steps.map((s) => {
    const conf = confidence.get(s.bet_id) ?? 0;
    const adds = s.delta_spend > 0;
    return {
      bet_id: s.bet_id,
      delta_attendees: s.delta_attendees,
      delta_spend: s.delta_spend,
      attendees_per_lakh: perLakh(s),
      score: adds ? (s.delta_attendees * conf) / (s.delta_spend / 100000) : null,
      net_if_reinvested: adds ? null : (-s.delta_spend / 100000) * best + s.delta_attendees,
    };
  });
}

export type BetRow = { bet_id: string; rank: number; name: string; call: string; incremental_attendees: number; budget_inr: number; confidence: number; score: number | null; attendees_per_lakh: number | null };

/** Priority score = incremental attendees × confidence ÷ cost (₹ lakh). Negative-budget bets (cuts) have no score. */
export function scoreBets(bets: { bet_id: string; rank: number; name: string; call: string; incremental_attendees: number; budget_inr: number; confidence: number }[]): BetRow[] {
  return bets.map((b) => {
    const lakh = b.budget_inr / 100000;
    const score = b.budget_inr > 0 ? (b.incremental_attendees * b.confidence) / lakh : null;
    return { ...b, score, attendees_per_lakh: b.budget_inr > 0 ? b.incremental_attendees / lakh : null };
  });
}
