// Write a parsed dataset into Postgres (one transaction). Used by setup, Reset and Import.
import type { Sql } from "@/lib/db/client";
import type { ParsedDataset } from "./parse";
import { BETS, SEED_TASKS } from "@/lib/seed-data";

const d = (ms: number | null) => (ms === null ? null : new Date(ms));

async function insertChunked(tx: Sql, table: string, rows: Record<string, unknown>[], chunk = 2000) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    if (part.length) await tx`insert into ${tx(table)} ${tx(part)}`;
  }
}

export async function loadDatasetIntoDb(sql: Sql, ds: ParsedDataset, opts: { actor: string; reason: string }) {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`truncate app.daily_marketing, app.people, app.interactions, app.registrations, app.registration_history, app.checkins, app.targets, app.event restart identity`;

    await t`insert into app.event ${t({
      id: 1,
      event_name: ds.event.event_name,
      history_start: ds.event.history_start,
      history_end: ds.event.history_end,
      event_starts_at: d(ds.event.event_starts_at),
      event_ends_at: d(ds.event.event_ends_at),
      timezone: ds.event.timezone,
      currency: ds.event.currency,
      fictional: true,
    })}`;

    for (const o of ds.owners) {
      await t`insert into app.owners ${t(o)} on conflict (owner_id) do update set owner_name = excluded.owner_name`;
    }

    // Campaigns: upsert source fields AND reset management fields to the dataset defaults.
    for (const c of ds.campaigns) {
      await t`insert into app.campaigns ${t({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        channel: c.channel,
        target_audience: c.target_audience,
        objective: c.objective,
        owner_id: c.owner_id,
        created_at: d(c.created_at),
        planned_start_at: d(c.planned_start_at),
        planned_end_at: d(c.planned_end_at),
        status: c.status,
        budget_inr: c.budget_inr,
        notes: "",
      })} on conflict (campaign_id) do update set
        campaign_name = excluded.campaign_name, channel = excluded.channel, target_audience = excluded.target_audience,
        objective = excluded.objective, owner_id = excluded.owner_id, created_at = excluded.created_at,
        planned_start_at = excluded.planned_start_at, planned_end_at = excluded.planned_end_at,
        status = excluded.status, budget_inr = excluded.budget_inr, notes = excluded.notes, updated_at = now()`;
    }
    const keep = ds.campaigns.map((c) => c.campaign_id);
    await t`delete from app.campaigns where campaign_id <> all(${keep})`;

    await insertChunked(t, "app.targets", ds.targets.map((x) => ({ ...x, effective_at: d(x.effective_at), origin: "source" })));
    await insertChunked(t, "app.daily_marketing", ds.daily.map((x) => ({ ...x, origin: "source" })));
    await insertChunked(t, "app.people", ds.people.map((x) => ({ ...x, first_seen_at: d(x.first_seen_at) })));
    await insertChunked(t, "app.interactions", ds.interactions.map((x) => ({ ...x, occurred_at: d(x.occurred_at) })));
    await insertChunked(t, "app.registrations", ds.registrations.map((x) => ({ ...x, registered_at: d(x.registered_at) })));
    await insertChunked(t, "app.registration_history", ds.history.map((x) => ({ ...x, effective_at: d(x.effective_at), origin: "source" })));
    await insertChunked(t, "app.checkins", ds.checkins.map((x) => ({ ...x, occurred_at: d(x.occurred_at) })));

    // Management seed (only when empty, so user work survives a data reset).
    for (const b of BETS) {
      await t`insert into app.bets ${t({ ...b })} on conflict (bet_id) do nothing`;
    }
    const [{ n }] = await t<{ n: number }[]>`select count(*)::int as n from app.tasks`;
    if (n === 0) {
      for (const task of SEED_TASKS) await t`insert into app.tasks ${t({ ...task, source: "seed" })}`;
    }

    await t`insert into app.meta (key, value) values ('health', ${t.json(ds.health as never)})
            on conflict (key) do update set value = excluded.value`;
    await t`insert into app.meta (key, value) values ('data_version', '1'::jsonb)
            on conflict (key) do update set value = to_jsonb((app.meta.value)::text::int + 1)`;
    await t`insert into app.audit_log (actor, action, entity, entity_id, reason, after)
            values (${opts.actor}, 'dataset_loaded', 'dataset', ${ds.health.fileName}, ${opts.reason},
                    ${t.json({ tables: ds.health.tables.map((x) => ({ table: x.table, kept: x.keptRows, copiesRemoved: x.importCopiesRemoved })) } as never)})`;
  });
}
