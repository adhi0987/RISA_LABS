// Time series and breakdowns, always bounded by the as-of cutoff (no leakage).
import type { Dataset } from "./types";
import { addDays, endOfDayIst, msToIstDate } from "./time";

export const TREND_METRICS = [
  "spend", "impressions", "clicks", "reported_reach", "sessions", "registration_starts",
  "identified", "registrations", "confirmations", "cancellations", "attendees",
] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export type TrendPoint = { period: string; value: number; cumulative: number };
export type Trend = { metric: TrendMetric; campaign_id: string | null; granularity: "day" | "week"; from: string; to: string; total: number; points: TrendPoint[]; note: string };

const NOTES: Partial<Record<TrendMetric, string>> = {
  impressions: "Anonymous platform events, not unique people.",
  clicks: "Anonymous platform events, not unique people.",
  reported_reach: "Platform-reported daily reach; summing across days does not give unique people.",
  sessions: "Anonymous landing-page sessions incl. repeats.",
  registration_starts: "Anonymous form-start events, not completed registrations.",
  confirmations: "Count of status versions changing to confirmed that day (re-confirmations count again).",
  attendees: "First verified admission day per distinct external person.",
};

function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(date, -dow);
}

export function computeTrend(ds: Dataset, asOf: string, metric: TrendMetric, campaignId: string | null, granularity: "day" | "week" = "day", from?: string): Trend {
  const cutoff = endOfDayIst(asOf);
  const start = from && from > ds.event.history_start ? from : ds.event.history_start;
  const external = new Set(ds.people.filter((p) => p.person_type === "external").map((p) => p.person_id));
  const byDay = new Map<string, number>();
  const add = (day: string, v: number) => byDay.set(day, (byDay.get(day) ?? 0) + v);
  const matches = (cid: string | null | undefined) => !campaignId || cid === campaignId;

  if (["spend", "impressions", "clicks", "reported_reach", "sessions", "registration_starts"].includes(metric)) {
    const field = ({ spend: "marketing_spend_inr", sessions: "landing_page_sessions" } as Record<string, string>)[metric] ?? metric;
    for (const d of ds.daily) if (d.activity_date <= asOf && matches(d.campaign_id)) add(d.activity_date, (d as unknown as Record<string, number>)[field]);
  } else if (metric === "identified") {
    for (const p of ds.people) if (p.person_type === "external" && p.first_seen_at <= cutoff && matches(p.first_campaign_id)) add(msToIstDate(p.first_seen_at), 1);
  } else if (metric === "registrations") {
    for (const r of ds.registrations) if (external.has(r.person_id) && r.registered_at <= cutoff && matches(r.campaign_id)) add(msToIstDate(r.registered_at), 1);
  } else if (metric === "confirmations" || metric === "cancellations") {
    const want = metric === "confirmations" ? "confirmed" : "cancelled";
    const regCampaign = new Map(ds.registrations.map((r) => [r.registration_id, r]));
    for (const h of ds.history) {
      if (h.status !== want || h.effective_at > cutoff) continue;
      const reg = regCampaign.get(h.registration_id);
      if (!reg || !external.has(reg.person_id) || !matches(reg.campaign_id)) continue;
      add(msToIstDate(h.effective_at), 1);
    }
  } else if (metric === "attendees") {
    const regByPerson = new Map(ds.registrations.map((r) => [r.person_id, r.campaign_id]));
    const first = new Map<string, number>();
    for (const c of ds.checkins) {
      if (c.occurred_at > cutoff || c.result !== "admitted" || c.verification !== "verified" || !external.has(c.person_id)) continue;
      if (!matches(regByPerson.get(c.person_id) ?? null)) continue;
      const cur = first.get(c.person_id);
      if (cur === undefined || c.occurred_at < cur) first.set(c.person_id, c.occurred_at);
    }
    for (const t of first.values()) add(msToIstDate(t), 1);
  }

  // Fill every day in range so charts and run-rates are honest about zero days.
  const points: TrendPoint[] = [];
  let cum = 0;
  // cumulative includes anything before `start`
  for (const [day, v] of byDay) if (day < start) cum += v;
  const buckets = new Map<string, number>();
  for (let day = start; day <= asOf; day = addDays(day, 1)) {
    const key = granularity === "week" ? mondayOf(day) : day;
    buckets.set(key, (buckets.get(key) ?? 0) + (byDay.get(day) ?? 0));
  }
  for (const [period, value] of buckets) {
    cum += value;
    points.push({ period, value: Math.round(value * 100) / 100, cumulative: Math.round(cum * 100) / 100 });
  }
  const total = points.reduce((a, p) => a + p.value, 0);
  return { metric, campaign_id: campaignId, granularity, from: start, to: asOf, total: Math.round(total * 100) / 100, points, note: NOTES[metric] ?? "" };
}

export const BREAKDOWN_DIMENSIONS = [
  "checkin_source", "checkin_results", "person_type", "first_touch_source", "engagement_events", "email_funnel", "attendance_by_day", "registration_lead_time",
] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export function computeBreakdown(ds: Dataset, asOf: string, dimension: BreakdownDimension, campaignId: string | null = null) {
  const cutoff = endOfDayIst(asOf);
  const external = new Set(ds.people.filter((p) => p.person_type === "external").map((p) => p.person_id));
  const count = <K extends string>(keys: K[]) => keys.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {} as Record<string, number>);
  const regByPerson = new Map(ds.registrations.map((r) => [r.person_id, r]));
  const inCampaign = (pid: string, cid: string | null | undefined) => !campaignId || (cid ?? regByPerson.get(pid)?.campaign_id) === campaignId;

  switch (dimension) {
    case "checkin_source": {
      const sources = new Map<string, Set<string>>();
      for (const c of ds.checkins) {
        if (c.occurred_at > cutoff || c.result !== "admitted" || c.verification !== "verified" || !external.has(c.person_id) || !inCampaign(c.person_id, null)) continue;
        let s = sources.get(c.person_id);
        if (!s) sources.set(c.person_id, (s = new Set()));
        s.add(c.source ?? "unknown");
      }
      const r = { scanner_only: 0, manual_only: 0, both: 0 };
      for (const s of sources.values()) {
        if (s.has("scanner") && s.has("manual")) r.both++;
        else if (s.has("manual")) r.manual_only++;
        else r.scanner_only++;
      }
      return { dimension, unit: "distinct verified external visitors", values: r, note: "Manual records can overlap scanner records; visitors are counted once." };
    }
    case "checkin_results": {
      const rows = ds.checkins.filter((c) => c.occurred_at <= cutoff);
      const typeOf = new Map(ds.people.map((p) => [p.person_id, p.person_type]));
      return {
        dimension,
        unit: "admission records (not people)",
        values: count(rows.map((c) => `${c.result}/${c.verification}`)),
        by_person_type: count(rows.map((c) => typeOf.get(c.person_id) ?? "unknown")),
        note: "Only admitted + verified records by external people count as attendance.",
      };
    }
    case "person_type":
      return { dimension, unit: "people first seen by the cutoff", values: count(ds.people.filter((p) => p.first_seen_at <= cutoff).map((p) => p.person_type)), note: "Targets apply to external people only." };
    case "first_touch_source":
      return { dimension, unit: "external people first seen by the cutoff", values: count(ds.people.filter((p) => p.person_type === "external" && p.first_seen_at <= cutoff).map((p) => p.first_touch_source ?? "unknown")), note: "Walk-ins have no campaign; that is not proof of zero acquisition cost." };
    case "engagement_events": {
      const rows = ds.interactions.filter((i) => i.occurred_at <= cutoff && (!campaignId || i.campaign_id === campaignId));
      const byCampaign: Record<string, Record<string, number>> = {};
      for (const i of rows) {
        const k = i.campaign_id ?? "none";
        (byCampaign[k] ??= {})[i.event_type] = (byCampaign[k][i.event_type] ?? 0) + 1;
      }
      return { dimension, unit: "identified interaction records", values: count(rows.map((i) => i.event_type)), by_campaign: byCampaign, distinct_people: new Set(rows.map((i) => i.person_id)).size, note: "Interactions are actions in a campaign context, not acquisition attribution." };
    }
    case "email_funnel": {
      const within = ds.interactions.filter(
        (i) => i.occurred_at <= cutoff && (i.event_type.startsWith("nurture_email") || i.event_type === "opted_out") && (!campaignId || i.campaign_id === campaignId),
      );
      const people = (t: string) => new Set(within.filter((i) => i.event_type === t).map((i) => i.person_id)).size;
      const sent = people("nurture_email_sent"), opened = people("nurture_email_opened"), clicked = people("nurture_email_clicked"), opted = people("opted_out");
      return { dimension, unit: "distinct people", values: { sent, opened, clicked, opted_out: opted, open_rate: sent ? opened / sent : null, click_rate: sent ? clicked / sent : null }, note: "Email opens do not prove incremental attendance." };
    }
    case "attendance_by_day": {
      const days = new Map<string, Set<string>>();
      for (const c of ds.checkins) {
        if (c.occurred_at > cutoff || c.result !== "admitted" || c.verification !== "verified" || !external.has(c.person_id) || !inCampaign(c.person_id, null)) continue;
        let s = days.get(c.person_id);
        if (!s) days.set(c.person_id, (s = new Set()));
        s.add(msToIstDate(c.occurred_at));
      }
      const tally: Record<string, number> = {};
      let both = 0;
      for (const s of days.values()) {
        for (const d of s) tally[d] = (tally[d] ?? 0) + 1;
        if (s.size > 1) both++;
      }
      return { dimension, unit: "distinct verified external visitors", values: { ...tally, both_days: both, unique_visitors: days.size, two_day_share: days.size ? both / days.size : null }, note: "Venue capacity planning uses the two-day share." };
    }
    case "registration_lead_time": {
      const eventStart = ds.event.event_starts_at;
      const buckets: Record<string, number> = { "0-7 days before": 0, "8-14": 0, "15-28": 0, "29-56": 0, "57+": 0 };
      for (const r of ds.registrations) {
        if (r.registered_at > cutoff || !external.has(r.person_id) || (campaignId && r.campaign_id !== campaignId)) continue;
        const days = Math.floor((eventStart - r.registered_at) / 86_400_000);
        const k = days <= 7 ? "0-7 days before" : days <= 14 ? "8-14" : days <= 28 ? "15-28" : days <= 56 ? "29-56" : "57+";
        buckets[k]++;
      }
      return { dimension, unit: "external registrations by days before the event", values: buckets, note: "" };
    }
  }
}
