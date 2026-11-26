// Core data types for the metrics engine.
// Timestamps are epoch milliseconds (UTC instants). Dates are 'YYYY-MM-DD' strings in IST.

export type EventInfo = {
  event_name: string;
  history_start: string;
  history_end: string;
  event_starts_at: number;
  event_ends_at: number;
  timezone: string;
  currency: string;
};

export type Target = {
  effective_at: number;
  identified_external_people_goal: number;
  registration_goal: number;
  unique_external_visitors_goal: number;
  marketing_budget_inr: number;
  target_version: string;
  origin?: string;
};

export type Owner = { owner_id: string; owner_name: string };

export type CampaignStatus = "active" | "paused" | "stopped" | "planned";

export type Campaign = {
  campaign_id: string;
  campaign_name: string;
  channel: string;
  target_audience: string;
  objective: string;
  owner_id: string;
  created_at: number;
  planned_start_at: number | null;
  planned_end_at: number | null;
  status: CampaignStatus;
  budget_inr: number;
  notes: string;
};

export type Daily = {
  activity_id: string;
  campaign_id: string;
  owner_id: string | null;
  activity_date: string;
  impressions: number;
  clicks: number;
  reported_reach: number;
  landing_page_sessions: number;
  registration_starts: number;
  marketing_spend_inr: number;
  platform: string | null;
};

export type Person = {
  person_id: string;
  person_name: string;
  person_type: string; // external | internal | staff | test
  first_seen_at: number;
  first_touch_source: string | null;
  first_campaign_id: string | null;
  owner_id: string | null;
};

export type Interaction = {
  interaction_id: string;
  person_id: string;
  campaign_id: string | null;
  owner_id: string | null;
  occurred_at: number;
  event_type: string;
  detail: string | null;
};

export type Registration = {
  registration_id: string;
  person_id: string;
  campaign_id: string | null;
  owner_id: string | null;
  registered_at: number;
};

export type RegStatus = "interested" | "confirmed" | "cancelled" | "waitlisted";

export type RegHistory = {
  history_id: string;
  registration_id: string;
  person_id: string | null;
  campaign_id: string | null;
  owner_id: string | null;
  effective_at: number;
  status: RegStatus;
};

export type Checkin = {
  event_id: string;
  person_id: string;
  registration_id: string | null;
  campaign_id: string | null;
  owner_id: string | null;
  occurred_at: number;
  result: string; // admitted | denied | pending
  verification: string; // verified | unverified
  source: string | null; // scanner | manual
};

export type Dataset = {
  event: EventInfo;
  targets: Target[];
  owners: Owner[];
  campaigns: Campaign[];
  daily: Daily[];
  people: Person[];
  interactions: Interaction[];
  registrations: Registration[];
  history: RegHistory[];
  checkins: Checkin[];
};

export type Thresholds = {
  scaleMaxRatio: number; // cost ≤ this × portfolio → scale
  fixMinRatio: number; // cost > this × portfolio → fix
  stopMinRatio: number; // cost ≥ this × portfolio AND down-funnel gap → stop
  stopDownFunnelGapPts: number; // percentage points below portfolio
  minConfirmedForVerdict: number; // sample-size guard
  paceTolerancePts: number; // budget pacing tolerance
};

export type ShowRateBand = { low: number; mid: number; high: number };

export type Settings = {
  thresholds: Thresholds;
  showRateBand: ShowRateBand; // confirmed → attended, used for pre-event projection (assumption)
  walkInShare: number; // walk-ins as share of campaign attendees (2025: 6.5%)
};
