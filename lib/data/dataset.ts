import "server-only";
// Server-side data access: loads the whole dataset once per data_version and caches it in memory.
// One tiny query (the version) per request; full reload only after a write.
import { getSql, resetSql } from "@/lib/db/client";
import type { Campaign, Dataset, Settings } from "@/engine/types";
import { mergeSettings } from "@/engine/metrics";
import { computeSnapshot, type Snapshot } from "@/engine/snapshot";
import { isValidDate } from "@/engine/time";

type Cache = { version: number; dataset: Dataset; settings: Settings; loadedAt: number };
const g = globalThis as unknown as { __dsCache?: Cache; __dsLoading?: Promise<Cache> };

const ms = (col: string) => `(extract(epoch from ${col}) * 1000)::float8`;

export async function getDataVersion(): Promise<number> {
  const sql = getSql();
  const rows = await sql<{ v: number }[]>`select (value)::text::int as v from app.meta where key = 'data_version'`;
  return rows[0]?.v ?? 0;
}

async function loadAll(version: number): Promise<Cache> {
  const sql = getSql();
  const [event, targets, owners, campaigns, daily, people, interactions, registrations, history, checkins, settingsRows] = await Promise.all([
    sql.unsafe(`select event_name, history_start::text, history_end::text, ${ms("event_starts_at")} as event_starts_at, ${ms("event_ends_at")} as event_ends_at, timezone, currency from app.event where id = 1`),
    sql.unsafe(`select ${ms("effective_at")} as effective_at, identified_external_people_goal, registration_goal, unique_external_visitors_goal, marketing_budget_inr::float8 as marketing_budget_inr, target_version, origin from app.targets order by effective_at`),
    sql.unsafe(`select owner_id, owner_name from app.owners order by owner_id`),
    sql.unsafe(`select campaign_id, campaign_name, channel, coalesce(target_audience,'') target_audience, coalesce(objective,'') objective, owner_id, ${ms("created_at")} created_at, ${ms("planned_start_at")} planned_start_at, ${ms("planned_end_at")} planned_end_at, status, budget_inr::float8 budget_inr, notes from app.campaigns order by campaign_id`),
    sql.unsafe(`select activity_id, campaign_id, owner_id, activity_date::text activity_date, impressions, clicks, reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr::float8 marketing_spend_inr, platform from app.daily_marketing`),
    sql.unsafe(`select person_id, person_name, person_type, ${ms("first_seen_at")} first_seen_at, first_touch_source, first_campaign_id, owner_id from app.people`),
    sql.unsafe(`select interaction_id, person_id, campaign_id, owner_id, ${ms("occurred_at")} occurred_at, event_type, null::text detail from app.interactions`),
    sql.unsafe(`select registration_id, person_id, campaign_id, owner_id, ${ms("registered_at")} registered_at from app.registrations`),
    sql.unsafe(`select history_id, registration_id, person_id, campaign_id, owner_id, ${ms("effective_at")} effective_at, status from app.registration_history`),
    sql.unsafe(`select event_id, person_id, registration_id, campaign_id, owner_id, ${ms("occurred_at")} occurred_at, result, verification, source from app.checkins`),
    sql.unsafe(`select value from app.settings where key = 'engine'`),
  ]);
  if (!event[0]) throw new Error("Dataset not loaded: app.event is empty. Run the setup script or Reset in /data.");
  const dataset: Dataset = {
    event: event[0] as unknown as Dataset["event"],
    targets: targets as unknown as Dataset["targets"],
    owners: owners as unknown as Dataset["owners"],
    campaigns: campaigns as unknown as Campaign[],
    daily: daily as unknown as Dataset["daily"],
    people: people as unknown as Dataset["people"],
    interactions: interactions as unknown as Dataset["interactions"],
    registrations: registrations as unknown as Dataset["registrations"],
    history: history as unknown as Dataset["history"],
    checkins: checkins as unknown as Dataset["checkins"],
  };
  const settings = mergeSettings((settingsRows[0]?.value as Partial<Settings>) ?? null);
  return { version, dataset, settings, loadedAt: Date.now() };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function getDataset(): Promise<Cache> {
  try {
    const version = await withTimeout(getDataVersion(), 12_000, "Database version check");
    if (g.__dsCache && g.__dsCache.version === version) return g.__dsCache;
    if (!g.__dsLoading) {
      // A stuck load must never wedge the server: time out, clear the in-flight promise, reset the pool.
      g.__dsLoading = withTimeout(loadAll(version), 30_000, "Dataset load")
        .then((c) => {
          g.__dsCache = c;
          return c;
        })
        .finally(() => {
          g.__dsLoading = undefined;
        });
    }
    return await g.__dsLoading;
  } catch (e) {
    resetSql();
    // Serve the last good dataset (stale but consistent) rather than failing the page.
    if (g.__dsCache) return g.__dsCache;
    throw e;
  }
}

export function clampAsOf(asOf: string | undefined | null, ds: Dataset): string {
  if (!asOf || !isValidDate(asOf)) return ds.event.history_end;
  if (asOf < ds.event.history_start) return ds.event.history_start;
  if (asOf > ds.event.history_end) return ds.event.history_end;
  return asOf;
}

export async function getSnapshot(asOfInput?: string | null): Promise<{ snapshot: Snapshot; cache: Cache; asOf: string }> {
  const cache = await getDataset();
  const asOf = clampAsOf(asOfInput, cache.dataset);
  return { snapshot: computeSnapshot(cache.dataset, asOf, cache.settings), cache, asOf };
}

/** Call after every write so all servers reload the dataset on their next request. */
export async function bumpDataVersion(tx?: ReturnType<typeof getSql>) {
  const sql = tx ?? getSql();
  await sql`update app.meta set value = to_jsonb((value)::text::int + 1) where key = 'data_version'`;
}
