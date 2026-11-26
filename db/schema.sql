-- CampusFest Growth Center schema.
-- Tables live in schema `app` (NOT exposed by Supabase's REST API, which only serves `public`).
-- Read-only views for the AI's ad-hoc SQL tool live in schema `analytics`.
-- Idempotent: safe to re-run. Source tables are re-filled by the ingest script.

create schema if not exists app;
create schema if not exists analytics;

-- ───────────────────────── Source tables (working copy of the dataset) ─────────────────────────
create table if not exists app.event (
  id int primary key default 1,
  event_name text not null,
  history_start date not null,
  history_end date not null,
  event_starts_at timestamptz not null,
  event_ends_at timestamptz not null,
  timezone text not null,
  currency text not null,
  fictional boolean not null default true
);

create table if not exists app.targets (
  id serial primary key,
  effective_at timestamptz not null,
  identified_external_people_goal int not null,
  registration_goal int not null,
  unique_external_visitors_goal int not null,
  marketing_budget_inr numeric not null,
  target_version text not null,
  origin text not null default 'source'        -- 'source' (dataset) | 'user' (added in app)
);

create table if not exists app.owners (
  owner_id text primary key,
  owner_name text not null
);

create table if not exists app.campaigns (
  campaign_id text primary key,
  campaign_name text not null,
  channel text not null,
  target_audience text,
  objective text,
  owner_id text not null,
  created_at timestamptz not null,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  -- management fields (not in source data)
  status text not null default 'active' check (status in ('active','paused','stopped','planned')),
  budget_inr numeric not null default 0,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists app.daily_marketing (
  activity_id text primary key,
  campaign_id text not null,
  owner_id text,
  activity_date date not null,
  impressions int not null default 0,
  clicks int not null default 0,
  reported_reach int not null default 0,
  landing_page_sessions int not null default 0,
  registration_starts int not null default 0,
  marketing_spend_inr numeric not null default 0,
  platform text,
  origin text not null default 'source'
);
create index if not exists daily_campaign_idx on app.daily_marketing (campaign_id, activity_date);

create table if not exists app.people (
  person_id text primary key,
  person_name text,
  person_type text not null,
  first_seen_at timestamptz not null,
  first_touch_source text,
  first_campaign_id text,
  owner_id text
);

create table if not exists app.interactions (
  interaction_id text primary key,
  person_id text not null,
  campaign_id text,
  owner_id text,
  occurred_at timestamptz not null,
  event_type text not null,
  detail text
);

create table if not exists app.registrations (
  registration_id text primary key,
  person_id text not null,
  campaign_id text,
  owner_id text,
  registered_at timestamptz not null
);

create table if not exists app.registration_history (
  history_id text primary key,
  registration_id text not null,
  person_id text,
  campaign_id text,
  owner_id text,
  effective_at timestamptz not null,
  status text not null,
  origin text not null default 'source'
);
create index if not exists reghist_reg_idx on app.registration_history (registration_id, effective_at);

create table if not exists app.checkins (
  event_id text primary key,
  person_id text not null,
  registration_id text,
  campaign_id text,
  owner_id text,
  occurred_at timestamptz not null,
  result text not null,
  verification text not null,
  source text
);

-- ───────────────────────── Management tables ─────────────────────────
create table if not exists app.bets (
  bet_id text primary key,
  rank int not null,
  name text not null,
  call text not null,                -- double_down | deprioritise | reject
  concept text not null,
  incremental_attendees int not null,
  budget_inr numeric not null,
  confidence numeric not null,
  kpis text not null,
  scale_rule text not null,
  change_rule text not null,
  stop_rule text not null
);

create table if not exists app.tasks (
  id serial primary key,
  title text not null,
  description text not null default '',
  campaign_id text references app.campaigns(campaign_id) on delete set null,
  bet_id text references app.bets(bet_id) on delete set null,
  owner_id text references app.owners(owner_id) on delete set null,
  due_date date,
  status text not null default 'todo' check (status in ('todo','doing','blocked','done')),
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  source text not null default 'manual' check (source in ('manual','ai','seed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.proposed_actions (
  id serial primary key,
  type text not null,
  payload jsonb not null,
  summary text not null,
  rationale text not null default '',
  evidence text not null default '',
  status text not null default 'pending' check (status in ('pending','applied','rejected','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists app.audit_log (
  id serial primary key,
  at timestamptz not null default now(),
  actor text not null,               -- 'user' | 'ai (confirmed by user)' | 'system'
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text not null default ''
);

create table if not exists app.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists app.meta (
  key text primary key,
  value jsonb not null
);

create table if not exists app.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

create table if not exists app.llm_usage (
  day date primary key,
  calls int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0
);

-- ───────────────────────── Analytics views (read-only surface for the AI's SQL tool) ─────────────────────────
-- Views run with the owner's rights, so analyst_ro needs SELECT on the views only, never on app.*.
create or replace view analytics.v_campaigns as
  select c.campaign_id, c.campaign_name, c.channel, c.target_audience, c.objective, c.owner_id, o.owner_name,
         c.planned_start_at, c.planned_end_at, c.status, c.budget_inr, c.notes
  from app.campaigns c left join app.owners o using (owner_id);

create or replace view analytics.v_targets as
  select effective_at, target_version, identified_external_people_goal, registration_goal,
         unique_external_visitors_goal, marketing_budget_inr, origin
  from app.targets;

create or replace view analytics.v_daily_marketing as
  select d.activity_id, d.activity_date, d.campaign_id, c.campaign_name, d.impressions, d.clicks, d.reported_reach,
         d.landing_page_sessions, d.registration_starts, d.marketing_spend_inr, d.platform
  from app.daily_marketing d left join app.campaigns c using (campaign_id);

create or replace view analytics.v_people as
  select p.person_id, p.person_name, p.person_type, (p.person_type = 'external') as is_external, p.first_seen_at,
         p.first_touch_source, p.first_campaign_id, c.campaign_name as first_campaign_name
  from app.people p left join app.campaigns c on c.campaign_id = p.first_campaign_id;

create or replace view analytics.v_interactions as
  select i.interaction_id, i.person_id, i.campaign_id, c.campaign_name, i.occurred_at, i.event_type, i.detail
  from app.interactions i left join app.campaigns c using (campaign_id);

create or replace view analytics.v_registrations as
  select r.registration_id, r.person_id, p.person_type, r.campaign_id, c.campaign_name, r.registered_at,
         (select h.status from app.registration_history h
           where h.registration_id = r.registration_id order by h.effective_at desc, h.history_id desc limit 1) as latest_status
  from app.registrations r
  left join app.people p using (person_id)
  left join app.campaigns c using (campaign_id);

create or replace view analytics.v_registration_history as
  select h.history_id, h.registration_id, h.person_id, h.campaign_id, c.campaign_name, h.effective_at, h.status
  from app.registration_history h left join app.campaigns c using (campaign_id);

create or replace view analytics.v_checkins as
  select k.event_id, k.person_id, p.person_type, k.registration_id, k.campaign_id, c.campaign_name, k.occurred_at,
         (k.occurred_at at time zone 'Asia/Kolkata')::date as event_day, k.result, k.verification, k.source,
         (k.result = 'admitted' and k.verification = 'verified') as is_verified_admission
  from app.checkins k
  left join app.people p using (person_id)
  left join app.campaigns c using (campaign_id);

create or replace view analytics.v_tasks as
  select t.id, t.title, t.description, t.campaign_id, c.campaign_name, t.bet_id, t.owner_id, o.owner_name,
         t.due_date, t.status, t.priority, t.source, t.created_at, t.updated_at
  from app.tasks t
  left join app.campaigns c on c.campaign_id = t.campaign_id
  left join app.owners o on o.owner_id = t.owner_id;

-- ───────────────────────── Read-only role for ad-hoc AI queries ─────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'analyst_ro') then
    create role analyst_ro nologin;
  end if;
end $$;
grant usage on schema analytics to analyst_ro;
grant select on all tables in schema analytics to analyst_ro;
revoke all on schema app from analyst_ro;
grant analyst_ro to current_user;
