// Snapshot engine: every metric "as known at the end of the selected IST day".
// Rules: dedupe by stable IDs (done at ingest), filter all timestamps ≤ cutoff, latest status version per
// registration ≤ cutoff, external + admitted + verified for attendance, distinct person_id everywhere.
import type { Campaign, Dataset, RegStatus, Settings, Target } from "./types";
import { addDays, daysBetween, endOfDayIst, msToIstDate } from "./time";
import { computeVerdict, type Verdict } from "./metrics";

export type Phase = "pre_event" | "event_live" | "post_event";

export type StatusCounts = Record<RegStatus, number>;

export type CampaignMetrics = {
  campaign_id: string;
  campaign_name: string;
  channel: string;
  owner_id: string;
  owner_name: string;
  status: Campaign["status"];
  budget_inr: number;
  // anonymous platform counts (NOT unique people)
  impressions: number;
  clicks: number;
  reported_reach: number;
  sessions: number;
  registration_starts: number;
  spend: number;
  // identified, person-level (distinct)
  identified: number;
  registered: number;
  status_counts: StatusCounts;
  confirmed: number;
  attended: number;
  confirmed_no_shows: number;
  rates: { ctr: number | null; reg_rate: number | null; confirm_rate: number | null; show_rate: number | null };
  cost: {
    cpm: number | null;
    per_identified: number | null;
    per_registered: number | null;
    per_confirmed: number | null;
    per_attendee: number | null;
  };
  budget_used_pct: number | null;
  plan_elapsed_pct: number | null;
  flags: string[];
  verdict: Verdict;
};

export type TargetProgress = {
  metric: "identified" | "registered" | "visitors" | "spend";
  label: string;
  actual: number;
  goal: number;
  pct_of_goal: number | null;
  expected_by_now: number | null; // linear pace assumption
  on_track: boolean | null;
};

export type Snapshot = {
  as_of: string;
  cutoff_ms: number;
  phase: Phase;
  days_to_event: number;
  event: Dataset["event"];
  target: Target | null;
  target_progress: TargetProgress[];
  totals: {
    impressions: number;
    clicks: number;
    reported_reach: number;
    sessions: number;
    registration_starts: number;
    spend: number;
    identified: number;
    identified_via_campaign: number;
    registered: number;
    status_counts: StatusCounts;
    confirmed: number;
    attended: number;
    attended_registrants: number;
    walk_ins: number;
    no_shows: number;
    confirmed_no_shows: number;
    attended_day1: number;
    attended_day2: number;
    attended_both_days: number;
  };
  portfolio: {
    reg_rate: number | null;
    confirm_rate: number | null;
    show_rate: number | null;
    cost_per_identified: number | null;
    cost_per_registered: number | null;
    cost_per_confirmed: number | null;
    cost_per_attendee: number | null;
  };
  campaigns: CampaignMetrics[];
  bottleneck: Bottleneck;
  projection: Projection;
  data_notes: {
    non_external_admissions: number;
    denied_or_pending_checkins: number;
    registrations_without_status_yet: number;
  };
};

export type BottleneckStage = { stage: string; entered: number; passed: number; lost: number; loss_rate: number | null };
export type Bottleneck = {
  stages: BottleneckStage[];
  worst_stage: string | null;
  campaign_excess_loss: { campaign_id: string; campaign_name: string; stage: string; campaign_rate: number; portfolio_rate: number; excess_people_lost: number }[];
};

export type Projection = {
  basis: "actual" | "run_rate";
  days_left: number;
  registration_run_rate_per_day: number | null;
  projected_registered: number;
  projected_confirmed: number;
  attendees_low: number;
  attendees_mid: number;
  attendees_high: number;
  visitors_goal: number | null;
  assumptions: string[];
};

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const emptyStatus = (): StatusCounts => ({ interested: 0, confirmed: 0, cancelled: 0, waitlisted: 0 });

export function activeTarget(targets: Target[], cutoff: number): Target | null {
  let best: Target | null = null;
  for (const t of targets) if (t.effective_at <= cutoff && (!best || t.effective_at >= best.effective_at)) best = t;
  return best;
}

export function computeSnapshot(ds: Dataset, asOf: string, settings: Settings): Snapshot {
  const cutoff = endOfDayIst(asOf);
  const ev = ds.event;
  const phase: Phase = cutoff < ev.event_starts_at ? "pre_event" : cutoff < ev.event_ends_at ? "event_live" : "post_event";
  const eventDate = msToIstDate(ev.event_starts_at);
  const daysToEvent = Math.max(0, daysBetween(asOf, eventDate));
  const postEvent = phase === "post_event";

  const ownerName = new Map(ds.owners.map((o) => [o.owner_id, o.owner_name]));
  const external = new Set<string>();
  for (const p of ds.people) if (p.person_type === "external") external.add(p.person_id);

  // ── identified people (first seen ≤ cutoff)
  let identified = 0;
  let identifiedViaCampaign = 0;
  const identifiedByCampaign = new Map<string, number>();
  for (const p of ds.people) {
    if (p.person_type !== "external" || p.first_seen_at > cutoff) continue;
    identified++;
    if (p.first_campaign_id) {
      identifiedViaCampaign++;
      identifiedByCampaign.set(p.first_campaign_id, (identifiedByCampaign.get(p.first_campaign_id) ?? 0) + 1);
    }
  }

  // ── latest status per registration ≤ cutoff
  const latest = new Map<string, { at: number; id: string; status: RegStatus }>();
  for (const h of ds.history) {
    if (h.effective_at > cutoff) continue;
    const cur = latest.get(h.registration_id);
    if (!cur || h.effective_at > cur.at || (h.effective_at === cur.at && h.history_id > cur.id)) {
      latest.set(h.registration_id, { at: h.effective_at, id: h.history_id, status: h.status });
    }
  }

  // ── one primary registration per external person (latest registered_at ≤ cutoff)
  const primaryReg = new Map<string, { registration_id: string; campaign_id: string | null; at: number }>();
  for (const r of ds.registrations) {
    if (r.registered_at > cutoff || !external.has(r.person_id)) continue;
    const cur = primaryReg.get(r.person_id);
    if (!cur || r.registered_at > cur.at) primaryReg.set(r.person_id, { registration_id: r.registration_id, campaign_id: r.campaign_id, at: r.registered_at });
  }
  let withoutStatus = 0;
  const personStatus = new Map<string, RegStatus>();
  for (const [pid, reg] of primaryReg) {
    const st = latest.get(reg.registration_id)?.status;
    if (!st) withoutStatus++;
    personStatus.set(pid, st ?? "interested");
  }

  // ── verified attendance ≤ cutoff
  const attendedDays = new Map<string, Set<string>>();
  let nonExternalAdmissions = 0;
  let deniedOrPending = 0;
  for (const c of ds.checkins) {
    if (c.occurred_at > cutoff) continue;
    if (!(c.result === "admitted" && c.verification === "verified")) {
      deniedOrPending++;
      continue;
    }
    if (!external.has(c.person_id)) {
      nonExternalAdmissions++;
      continue;
    }
    const day = msToIstDate(c.occurred_at);
    let s = attendedDays.get(c.person_id);
    if (!s) attendedDays.set(c.person_id, (s = new Set()));
    s.add(day);
  }
  const day1 = eventDate;
  const day2 = addDays(eventDate, 1);
  let attDay1 = 0, attDay2 = 0, attBoth = 0;
  for (const days of attendedDays.values()) {
    if (days.has(day1)) attDay1++;
    if (days.has(day2)) attDay2++;
    if (days.has(day1) && days.has(day2)) attBoth++;
  }

  // ── per-campaign person-level aggregation
  type Agg = { registered: number; status: StatusCounts; attended: number; confirmedNoShows: number };
  const agg = new Map<string, Agg>();
  const getAgg = (cid: string) => {
    let a = agg.get(cid);
    if (!a) agg.set(cid, (a = { registered: 0, status: emptyStatus(), attended: 0, confirmedNoShows: 0 }));
    return a;
  };
  const totalStatus = emptyStatus();
  let attendedRegistrants = 0;
  let noShows = 0;
  let confirmedNoShows = 0;
  for (const [pid, reg] of primaryReg) {
    const st = personStatus.get(pid)!;
    totalStatus[st]++;
    const attended = attendedDays.has(pid);
    if (attended) attendedRegistrants++;
    else {
      noShows++;
      if (st === "confirmed") confirmedNoShows++;
    }
    if (reg.campaign_id) {
      const a = getAgg(reg.campaign_id);
      a.registered++;
      a.status[st]++;
      if (attended) a.attended++;
      else if (st === "confirmed") a.confirmedNoShows++;
    }
  }
  const walkIns = [...attendedDays.keys()].filter((pid) => !primaryReg.has(pid)).length;

  // ── anonymous daily metrics and spend
  type DailyAgg = { impressions: number; clicks: number; reach: number; sessions: number; starts: number; spend: number; last7Starts: number };
  const dailyAgg = new Map<string, DailyAgg>();
  const totalsDaily = { impressions: 0, clicks: 0, reach: 0, sessions: 0, starts: 0, spend: 0 };
  for (const d of ds.daily) {
    if (d.activity_date > asOf) continue;
    let a = dailyAgg.get(d.campaign_id);
    if (!a) dailyAgg.set(d.campaign_id, (a = { impressions: 0, clicks: 0, reach: 0, sessions: 0, starts: 0, spend: 0, last7Starts: 0 }));
    a.impressions += d.impressions;
    a.clicks += d.clicks;
    a.reach += d.reported_reach;
    a.sessions += d.landing_page_sessions;
    a.starts += d.registration_starts;
    a.spend += d.marketing_spend_inr;
    totalsDaily.impressions += d.impressions;
    totalsDaily.clicks += d.clicks;
    totalsDaily.reach += d.reported_reach;
    totalsDaily.sessions += d.landing_page_sessions;
    totalsDaily.starts += d.registration_starts;
    totalsDaily.spend += d.marketing_spend_inr;
  }

  // ── portfolio rates (campaign-attributed registrations; spend across all campaigns)
  let campRegistered = 0, campConfirmed = 0, campAttended = 0;
  for (const a of agg.values()) {
    campRegistered += a.registered;
    campConfirmed += a.status.confirmed;
    campAttended += a.attended;
  }
  const totalAttended = attendedDays.size;
  const portfolio = {
    reg_rate: ratio(campRegistered, identifiedViaCampaign),
    confirm_rate: ratio(campConfirmed, campRegistered),
    show_rate: phase === "pre_event" ? null : ratio(campAttended, campRegistered),
    cost_per_identified: ratio(totalsDaily.spend, identifiedViaCampaign),
    cost_per_registered: ratio(totalsDaily.spend, campRegistered),
    cost_per_confirmed: ratio(totalsDaily.spend, campConfirmed),
    // Portfolio ₹ per attendee uses ALL verified visitors (incl. walk-ins), as in the deck (₹134).
    cost_per_attendee: phase === "pre_event" ? null : ratio(totalsDaily.spend, totalAttended),
  };

  const target = activeTarget(ds.targets, cutoff);

  // ── campaigns
  const campaigns: CampaignMetrics[] = ds.campaigns.map((c) => {
    const a = agg.get(c.campaign_id) ?? { registered: 0, status: emptyStatus(), attended: 0, confirmedNoShows: 0 };
    const d = dailyAgg.get(c.campaign_id) ?? { impressions: 0, clicks: 0, reach: 0, sessions: 0, starts: 0, spend: 0, last7Starts: 0 };
    const ident = identifiedByCampaign.get(c.campaign_id) ?? 0;
    const confirmed = a.status.confirmed;
    const verdict = computeVerdict({
      postEvent,
      spend: d.spend,
      confirmed,
      attended: a.attended,
      registered: a.registered,
      portfolioCost: postEvent ? portfolio.cost_per_attendee : portfolio.cost_per_confirmed,
      portfolioDownFunnel: postEvent ? portfolio.show_rate : portfolio.confirm_rate,
      thresholds: settings.thresholds,
    });
    let planElapsed: number | null = null;
    if (c.planned_start_at && c.planned_end_at && c.planned_end_at > c.planned_start_at) {
      planElapsed = Math.min(1, Math.max(0, (cutoff - c.planned_start_at) / (c.planned_end_at - c.planned_start_at)));
    }
    const budgetUsed = c.budget_inr > 0 ? d.spend / c.budget_inr : null;
    const flags: string[] = [];
    if (budgetUsed !== null && budgetUsed > 1) flags.push(`Over budget: spent ${Math.round(budgetUsed * 100)}% of ₹${Math.round(c.budget_inr).toLocaleString("en-IN")}.`);
    else if (budgetUsed !== null && planElapsed !== null && (budgetUsed - planElapsed) * 100 > settings.thresholds.paceTolerancePts)
      flags.push(`Spending ahead of plan: ${Math.round(budgetUsed * 100)}% of budget used with ${Math.round(planElapsed * 100)}% of the planned window elapsed.`);
    if (c.status !== "active") flags.push(`Campaign status is ${c.status}.`);
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      channel: c.channel,
      owner_id: c.owner_id,
      owner_name: ownerName.get(c.owner_id) ?? c.owner_id,
      status: c.status,
      budget_inr: c.budget_inr,
      impressions: d.impressions,
      clicks: d.clicks,
      reported_reach: d.reach,
      sessions: d.sessions,
      registration_starts: d.starts,
      spend: d.spend,
      identified: ident,
      registered: a.registered,
      status_counts: a.status,
      confirmed,
      attended: a.attended,
      confirmed_no_shows: a.confirmedNoShows,
      rates: {
        ctr: ratio(d.clicks, d.impressions),
        reg_rate: ratio(a.registered, ident),
        confirm_rate: ratio(confirmed, a.registered),
        show_rate: phase === "pre_event" ? null : ratio(a.attended, a.registered),
      },
      cost: {
        cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : null,
        per_identified: ratio(d.spend, ident),
        per_registered: ratio(d.spend, a.registered),
        per_confirmed: ratio(d.spend, confirmed),
        per_attendee: phase === "pre_event" ? null : ratio(d.spend, a.attended),
      },
      budget_used_pct: budgetUsed === null ? null : budgetUsed * 100,
      plan_elapsed_pct: planElapsed === null ? null : planElapsed * 100,
      flags,
      verdict,
    };
  });

  // ── targets vs actuals (linear pace from history start to event start = simple assumption)
  const target_progress: TargetProgress[] = [];
  if (target) {
    const start = endOfDayIst(addDays(ev.history_start, -1));
    const elapsed = Math.min(1, Math.max(0, (cutoff - start) / (ev.event_starts_at - start)));
    const mk = (metric: TargetProgress["metric"], label: string, actual: number, goal: number, paced: boolean): TargetProgress => {
      const expected = paced ? goal * elapsed : null;
      return {
        metric,
        label,
        actual,
        goal,
        pct_of_goal: goal > 0 ? (actual / goal) * 100 : null,
        expected_by_now: expected,
        on_track: metric === "spend" ? actual <= goal : expected === null ? (phase === "pre_event" ? null : actual >= goal) : actual >= expected * 0.95,
      };
    };
    target_progress.push(mk("identified", "Identified external people", identified, target.identified_external_people_goal, true));
    target_progress.push(mk("registered", "Registered external people", primaryReg.size, target.registration_goal, true));
    target_progress.push(mk("visitors", "Verified external visitors", totalAttended, target.unique_external_visitors_goal, false));
    target_progress.push(mk("spend", "Marketing spend vs budget", totalsDaily.spend, target.marketing_budget_inr, false));
  }

  // ── bottleneck finder
  const regStage: BottleneckStage = { stage: "identified → registered", entered: identifiedViaCampaign, passed: campRegistered, lost: Math.max(0, identifiedViaCampaign - campRegistered), loss_rate: identifiedViaCampaign ? Math.max(0, identifiedViaCampaign - campRegistered) / identifiedViaCampaign : null };
  const stages: BottleneckStage[] = [regStage];
  if (phase === "pre_event") {
    stages.push({ stage: "registered → confirmed", entered: campRegistered, passed: campConfirmed, lost: campRegistered - campConfirmed, loss_rate: ratio(campRegistered - campConfirmed, campRegistered) });
  } else {
    stages.push({ stage: "registered → attended", entered: campRegistered, passed: campAttended, lost: campRegistered - campAttended, loss_rate: ratio(campRegistered - campAttended, campRegistered) });
  }
  const worst = stages.reduce((w, s) => (s.lost > (w?.lost ?? -1) ? s : w), null as BottleneckStage | null);
  const excess: Bottleneck["campaign_excess_loss"] = [];
  for (const cm of campaigns) {
    const checks: [string, number | null, number | null, number][] = [
      ["identified → registered", cm.rates.reg_rate, portfolio.reg_rate, cm.identified],
      phase === "pre_event"
        ? ["registered → confirmed", cm.rates.confirm_rate, portfolio.confirm_rate, cm.registered]
        : ["registered → attended", cm.rates.show_rate, portfolio.show_rate, cm.registered],
    ];
    for (const [stage, rate, prate, entered] of checks) {
      if (rate === null || prate === null || entered === 0) continue;
      const lostExtra = (prate - rate) * entered;
      if (lostExtra >= 1) excess.push({ campaign_id: cm.campaign_id, campaign_name: cm.campaign_name, stage, campaign_rate: rate, portfolio_rate: prate, excess_people_lost: Math.round(lostExtra) });
    }
  }
  excess.sort((a, b) => b.excess_people_lost - a.excess_people_lost);

  // ── projection
  let projection: Projection;
  const goal = target?.unique_external_visitors_goal ?? null;
  if (phase === "post_event") {
    projection = {
      basis: "actual",
      days_left: 0,
      registration_run_rate_per_day: null,
      projected_registered: primaryReg.size,
      projected_confirmed: totalStatus.confirmed,
      attendees_low: totalAttended,
      attendees_mid: totalAttended,
      attendees_high: totalAttended,
      visitors_goal: goal,
      assumptions: ["Event is over: attendance is the observed verified count."],
    };
  } else {
    const weekAgo = endOfDayIst(addDays(asOf, -7));
    let last7 = 0;
    for (const r of ds.registrations) if (external.has(r.person_id) && r.registered_at > weekAgo && r.registered_at <= cutoff) last7++;
    const rate = last7 / 7;
    const projRegistered = primaryReg.size + rate * daysToEvent;
    const confirmRate = ratio(totalStatus.confirmed, primaryReg.size) ?? 0;
    const projConfirmed = projRegistered * confirmRate;
    const band = settings.showRateBand;
    const withWalkIns = (x: number) => Math.round(x * (1 + settings.walkInShare));
    projection = {
      basis: "run_rate",
      days_left: daysToEvent,
      registration_run_rate_per_day: rate,
      projected_registered: Math.round(projRegistered),
      projected_confirmed: Math.round(projConfirmed),
      attendees_low: Math.max(totalAttended, withWalkIns(projConfirmed * band.low)),
      attendees_mid: Math.max(totalAttended, withWalkIns(projConfirmed * band.mid)),
      attendees_high: Math.max(totalAttended, withWalkIns(projConfirmed * band.high)),
      visitors_goal: goal,
      assumptions: [
        `Registrations continue at the trailing 7-day rate (${rate.toFixed(1)}/day) for ${daysToEvent} days.`,
        `Current confirm rate (${Math.round(confirmRate * 100)}%) holds for new registrations.`,
        `Confirmed → attended band ${Math.round(band.low * 100)}–${Math.round(band.high * 100)}% (assumption, editable in Settings).`,
        `Walk-ins add ${(settings.walkInShare * 100).toFixed(1)}% on top (2025 ratio).`,
      ],
    };
  }

  return {
    as_of: asOf,
    cutoff_ms: cutoff,
    phase,
    days_to_event: daysToEvent,
    event: ev,
    target,
    target_progress,
    totals: {
      impressions: totalsDaily.impressions,
      clicks: totalsDaily.clicks,
      reported_reach: totalsDaily.reach,
      sessions: totalsDaily.sessions,
      registration_starts: totalsDaily.starts,
      spend: totalsDaily.spend,
      identified,
      identified_via_campaign: identifiedViaCampaign,
      registered: primaryReg.size,
      status_counts: totalStatus,
      confirmed: totalStatus.confirmed,
      attended: totalAttended,
      attended_registrants: attendedRegistrants,
      walk_ins: walkIns,
      no_shows: phase === "pre_event" ? 0 : noShows,
      confirmed_no_shows: phase === "pre_event" ? 0 : confirmedNoShows,
      attended_day1: attDay1,
      attended_day2: attDay2,
      attended_both_days: attBoth,
    },
    portfolio,
    campaigns,
    bottleneck: { stages, worst_stage: worst?.stage ?? null, campaign_excess_loss: excess.slice(0, 6) },
    projection,
    data_notes: {
      non_external_admissions: nonExternalAdmissions,
      denied_or_pending_checkins: deniedOrPending,
      registrations_without_status_yet: withoutStatus,
    },
  };
}
