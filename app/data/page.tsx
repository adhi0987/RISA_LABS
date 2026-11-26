import Link from "next/link";
import { getDataset, clampAsOf } from "@/lib/data/dataset";
import { getHealth } from "@/lib/data/management";
import { getSql } from "@/lib/db/client";
import { activeTarget } from "@/engine/snapshot";
import { endOfDayIst, msToIstLabel } from "@/engine/time";
import { Badge, Card, Note, PageHeader, Td, Th } from "@/components/ui";
import { AddDailyForm, DailyRowEditor, DeleteTargetButton, ResetImportPanel, StatusAppendForm, TargetVersionForm } from "@/components/forms/data-forms";
import { inr, istDateTime, num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DataPage({ searchParams }: PageProps<"/data">) {
  const sp = await searchParams;
  const { dataset } = await getDataset();
  const asOf = clampAsOf(typeof sp.asOf === "string" ? sp.asOf : null, dataset);
  const campaign = typeof sp.dc === "string" ? sp.dc : dataset.campaigns[0]?.campaign_id ?? "";
  const regQuery = typeof sp.reg === "string" ? sp.reg.trim() : "";
  const sql = getSql();
  const [health, targets, dailyRows, regMatches] = await Promise.all([
    getHealth(),
    sql`select id, effective_at, target_version, identified_external_people_goal, registration_goal, unique_external_visitors_goal, marketing_budget_inr::float8 marketing_budget_inr, origin from app.targets order by effective_at`,
    sql`select activity_id, activity_date::text activity_date, impressions, clicks, landing_page_sessions, registration_starts, marketing_spend_inr::float8 marketing_spend_inr, origin
        from app.daily_marketing where campaign_id = ${campaign} and activity_date <= ${asOf} order by activity_date desc limit 21`,
    regQuery
      ? sql`select r.registration_id, r.person_id, p.person_name, p.person_type, c.campaign_name, r.registered_at
            from app.registrations r join app.people p using (person_id) left join app.campaigns c on c.campaign_id = r.campaign_id
            where r.registration_id ilike ${regQuery} or r.person_id ilike ${regQuery} or p.person_name ilike ${"%" + regQuery + "%"} order by r.registration_id limit 8`
      : Promise.resolve([]),
  ]);
  const histories = regMatches.length
    ? await sql`select history_id, registration_id, effective_at, status, origin from app.registration_history where registration_id = any(${regMatches.map((r) => r.registration_id)}) order by registration_id, effective_at`
    : [];
  const current = activeTarget(dataset.targets, endOfDayIst(asOf));
  const q = (extra: Record<string, string>) => `/data?${new URLSearchParams({ asOf, dc: campaign, ...(regQuery && { reg: regQuery }), ...extra }).toString()}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Data" description="The working copy of the source dataset. Every edit is saved, written to the activity log, and immediately changes the dashboard and the AI analyst's answers." />

      <Card title="Dataset health" subtitle={health ? `${health.fileName} · loaded ${istDateTime(health.parsedAt)} IST` : "No dataset loaded"}>
        {health && (
          <>
            <table className="min-w-full">
              <thead><tr><Th>Table</Th><Th className="text-right">Source rows</Th><Th className="text-right">Import copies removed</Th><Th className="text-right">Conflicting IDs</Th><Th className="text-right">Rows kept</Th></tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {health.tables.map((t) => (
                  <tr key={t.table}><Td>{t.table}</Td><Td className="num text-right">{num(t.sourceRows)}</Td><Td className="num text-right">{t.importCopiesRemoved ? <span className="font-semibold text-amber-700">{num(t.importCopiesRemoved)}</span> : 0}</Td><Td className="num text-right">{num(t.conflictingDuplicates)}</Td><Td className="num text-right">{num(t.keptRows)}</Td></tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-2 space-y-0.5">{health.notes.map((n) => <li key={n} className="text-xs text-zinc-500">• {n}</li>)}</ul>
          </>
        )}
      </Card>

      <Card title="Targets (versioned)" subtitle="Each version takes effect at its timestamp; snapshots use the latest version effective by the selected day. Source versions are read-only; add a new version to change goals or budget.">
        <table className="min-w-full">
          <thead><tr><Th>Version</Th><Th>Effective (IST)</Th><Th className="text-right">Identified</Th><Th className="text-right">Registrations</Th><Th className="text-right">Visitors</Th><Th className="text-right">Budget</Th><Th /></tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {targets.map((t) => (
              <tr key={t.id} className={current && current.target_version === t.target_version && new Date(t.effective_at).getTime() === current.effective_at ? "bg-indigo-50/50" : ""}>
                <Td>{t.target_version} {t.origin === "user" && <Badge tone="violet">added in app</Badge>}</Td>
                <Td className="num">{msToIstLabel(new Date(t.effective_at).getTime())}</Td>
                <Td className="num text-right">{num(t.identified_external_people_goal)}</Td>
                <Td className="num text-right">{num(t.registration_goal)}</Td>
                <Td className="num text-right">{num(t.unique_external_visitors_goal)}</Td>
                <Td className="num text-right">{inr(t.marketing_budget_inr)}</Td>
                <Td>{t.origin === "user" && <DeleteTargetButton id={t.id} />}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <TargetVersionForm current={current} defaultEffective={`${asOf}T09:00`} />
        </div>
      </Card>

      <Card title="Daily marketing (edit spend and platform counts)" subtitle={`Latest 21 days up to ${asOf} for the selected campaign. Negative spend = vendor credit.`}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {dataset.campaigns.map((c) => (
            <Link key={c.campaign_id} href={q({ dc: c.campaign_id })} className={`rounded-full border px-2.5 py-0.5 text-xs ${c.campaign_id === campaign ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>{c.campaign_name}</Link>
          ))}
        </div>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="min-w-full">
            <thead><tr><Th>Date</Th><Th>ID</Th><Th className="text-right">Impressions</Th><Th className="text-right">Clicks</Th><Th className="text-right">Sessions</Th><Th className="text-right">Form starts</Th><Th className="text-right">Spend ₹</Th><Th /></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {dailyRows.map((r) => (
                <tr key={r.activity_id}>
                  <Td className="num">{r.activity_date}</Td>
                  <Td className="text-xs text-zinc-500">{r.activity_id}{r.origin === "user" && <Badge tone="violet" className="ml-1">edited</Badge>}</Td>
                  <DailyRowEditor row={{ activity_id: r.activity_id, impressions: r.impressions, clicks: r.clicks, landing_page_sessions: r.landing_page_sessions, registration_starts: r.registration_starts, marketing_spend_inr: r.marketing_spend_inr }} />
                </tr>
              ))}
              {dailyRows.length === 0 && <tr><Td className="text-zinc-500">No rows up to this date.</Td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <AddDailyForm campaigns={dataset.campaigns.map((c) => ({ campaign_id: c.campaign_id, campaign_name: c.campaign_name }))} defaultDate={asOf} />
        </div>
      </Card>

      <Card title="Registration status history" subtitle="Find a registration by ID (R0001), person ID (E0001) or name, then append a new full-state status version. Earlier snapshots are unaffected.">
        <form method="get" action="/data" className="flex gap-2">
          <input type="hidden" name="asOf" value={asOf} />
          <input type="hidden" name="dc" value={campaign} />
          <input name="reg" defaultValue={regQuery} placeholder="R0002, E0002 or a name" className="w-72 rounded-md border border-zinc-300 px-2 py-1.5 text-sm" />
          <button className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50">Search</button>
        </form>
        {regQuery && regMatches.length === 0 && <div className="mt-3 text-sm text-zinc-500">No registration matches “{regQuery}”.</div>}
        <div className="mt-3 space-y-4">
          {regMatches.map((r) => (
            <div key={r.registration_id} className="rounded-lg border border-zinc-200 p-3">
              <div className="text-sm"><span className="font-medium">{r.registration_id}</span> · {r.person_name} ({r.person_id}, {r.person_type}) · {r.campaign_name ?? "no campaign"} · registered {msToIstLabel(new Date(r.registered_at).getTime())} IST</div>
              <ol className="mt-1 space-y-0.5 text-xs text-zinc-600">
                {histories.filter((h) => h.registration_id === r.registration_id).map((h) => (
                  <li key={h.history_id}>{msToIstLabel(new Date(h.effective_at).getTime())} → <span className="font-medium">{h.status}</span> <span className="text-zinc-400">({h.history_id}{h.origin === "user" ? ", added in app" : ""})</span></li>
                ))}
              </ol>
              <div className="mt-2"><StatusAppendForm registrationId={r.registration_id} defaultAt={`${asOf}T12:00`} /></div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Reset or import">
        <ResetImportPanel />
      </Card>
      <Note>The original workbook is kept in the repository at data/original/Attendee Dataset.xlsx for testing.</Note>
    </div>
  );
}
