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

export function runPlan(scenario: Scenario, bench: Map<string, Bench>, segments = DEFAULT_SEGMENTS, a = DEFAULT_PLANNER_ASSUMPTIONS): PlanResult {
  const results: SegmentResult[] = [];
  const pending: { seg: SegmentInputs; b: Bench; p: DriverParams }[] = [];
  for (const seg of segments) {
    const b = bench.get(seg.campaign_id) ?? { reg_rate: 0, show_rate: 0, cost_per_identified: 0 };
    const p = seg[scenario];
    if (seg.driver === "referral_k") {
      pending.push({ seg, b, p });
      continue;
    }
    results.push(compute(seg, b, p, scenario, a, 0));
  }
  // Referral identified = k × registrants from all other segments.
  const otherRegistered = results.reduce((s, r) => s + r.registered, 0);
  for (const { seg, b, p } of pending) results.push(compute(seg, b, p, scenario, a, otherRegistered));
  results.sort((x, y) => segments.findIndex((s) => s.id === x.id) - segments.findIndex((s) => s.id === y.id));

  const campaignAttendees = results.reduce((s, r) => s + r.attendees, 0);
  const walkIns = campaignAttendees * a.walk_in_share;
  const programme = scenario === "stretch" ? a.programme_costs_stretch : 0;
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

function compute(seg: SegmentInputs, b: Bench, p: DriverParams, scenario: Scenario, a: PlannerAssumptions, otherRegistered: number): SegmentResult {
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
  const showRate = Math.min(1, b.show_rate + (scenario === "stretch" ? seg.show_uplift_pts_stretch / 100 : 0));
  const registered = identified * regRate;
  const attendees = registered * showRate;
  let spend = seg.driver === "spend" ? p.spend ?? 0 : identified * cpi;
  if (scenario === "stretch" && seg.extra_cost_per_attendee_stretch) spend += attendees * seg.extra_cost_per_attendee_stretch;
  return { id: seg.id, name: seg.name, campaign_id: seg.campaign_id, driver_label: label, identified, reg_rate: regRate, show_rate: showRate, registered, attendees, spend, cost_per_identified_2025: b.cost_per_identified };
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
