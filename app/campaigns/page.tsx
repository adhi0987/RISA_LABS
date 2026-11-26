import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import { getSnapshot } from "@/lib/data/dataset";
import { listTasks } from "@/lib/data/management";
import { computeTrend } from "@/engine/series";
import { addDays } from "@/engine/time";
import { Badge, Card, PageHeader, Progress, Td, Th, VerdictBadge, Note, Assumption } from "@/components/ui";
import { DailyCumulativeChart } from "@/components/charts";
import { CampaignEditForm, QuickTaskForm, ReallocateForm } from "@/components/forms/campaign-forms";
import { TaskList } from "@/components/tasks/task-list";
import { inr, num, pct, pctUnits } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  const sp = await searchParams;
  const { snapshot: s, cache, asOf } = await getSnapshot(typeof sp.asOf === "string" ? sp.asOf : null);
  const selectedId = typeof sp.c === "string" ? sp.c : null;
  const selected = s.campaigns.find((c) => c.campaign_id === selectedId) ?? null;
  const post = s.phase === "post_event";
  const q = `asOf=${asOf}`;
  const campaignMeta = new Map(cache.dataset.campaigns.map((c) => [c.campaign_id, c]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        description={
          <>
            Unit economics and verdicts as of the selected date. Identified = first-touch campaign; registered/confirmed/attended = campaign recorded on the registration.
            Budgets per campaign are <Assumption>seeded from the 2025 spend mix</Assumption> and editable.
          </>
        }
      />

      <Card>
        <div className="-mx-4 -my-4 overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50/60">
              <tr>
                <Th className="pl-4">Campaign</Th>
                <Th>Verdict</Th>
                <Th className="text-right">Spend / budget</Th>
                <Th className="text-right">Identified</Th>
                <Th className="text-right">Registered</Th>
                <Th className="text-right">Confirmed</Th>
                {s.phase !== "pre_event" && <Th className="text-right">Attended</Th>}
                <Th className="text-right">Reg rate</Th>
                <Th className="text-right">Confirm rate</Th>
                {s.phase !== "pre_event" && <Th className="text-right">Show rate</Th>}
                <Th className="text-right">₹ / confirmed</Th>
                {s.phase !== "pre_event" && <Th className="text-right">₹ / attendee</Th>}
                <Th className="pr-4 text-right">vs portfolio</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {s.campaigns.map((c) => (
                <tr key={c.campaign_id} className={c.campaign_id === selectedId ? "bg-indigo-50/50" : "hover:bg-zinc-50"}>
                  <Td className="pl-4">
                    <Link href={`/campaigns?${q}&c=${c.campaign_id}`} className="font-medium text-zinc-900 hover:text-indigo-600">{c.campaign_name}</Link>
                    <div className="text-xs text-zinc-500">
                      {c.campaign_id} · {c.channel} · {c.owner_name}
                      {c.status !== "active" && <Badge tone="amber" className="ml-1">{c.status}</Badge>}
                    </div>
                  </Td>
                  <Td><VerdictBadge call={c.verdict.call} />{c.flags.length > 0 && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-500" aria-label={c.flags.join(" ")} />}</Td>
                  <Td className="num text-right">
                    {inr(c.spend, { compact: true })} <span className="text-zinc-400">/ {inr(c.budget_inr, { compact: true })}</span>
                    <div className="mt-1 w-24 ml-auto"><Progress value={c.budget_used_pct} marker={c.plan_elapsed_pct} tone={c.budget_used_pct !== null && c.budget_used_pct > 100 ? "rose" : "emerald"} /></div>
                  </Td>
                  <Td className="num text-right">{num(c.identified)}</Td>
                  <Td className="num text-right">{num(c.registered)}</Td>
                  <Td className="num text-right">{num(c.confirmed)}</Td>
                  {s.phase !== "pre_event" && <Td className="num text-right">{num(c.attended)}</Td>}
                  <Td className="num text-right">{pct(c.rates.reg_rate)}</Td>
                  <Td className="num text-right">{pct(c.rates.confirm_rate)}</Td>
                  {s.phase !== "pre_event" && <Td className="num text-right">{pct(c.rates.show_rate)}</Td>}
                  <Td className="num text-right">{inr(c.cost.per_confirmed)}</Td>
                  {s.phase !== "pre_event" && <Td className="num text-right">{inr(c.cost.per_attendee)}</Td>}
                  <Td className="num pr-4 text-right">{pctUnits(c.verdict.ratio_pct)}</Td>
                </tr>
              ))}
              <tr className="bg-zinc-50/60 font-medium">
                <Td className="pl-4">Portfolio</Td>
                <Td />
                <Td className="num text-right">{inr(s.totals.spend, { compact: true })} <span className="text-zinc-400">/ {inr(s.target?.marketing_budget_inr ?? null, { compact: true })}</span></Td>
                <Td className="num text-right">{num(s.totals.identified_via_campaign)}</Td>
                <Td className="num text-right">{num(s.totals.registered)}</Td>
                <Td className="num text-right">{num(s.totals.confirmed)}</Td>
                {s.phase !== "pre_event" && <Td className="num text-right">{num(s.totals.attended)}<div className="text-[10px] font-normal text-zinc-500">incl. {num(s.totals.walk_ins)} walk-ins</div></Td>}
                <Td className="num text-right">{pct(s.portfolio.reg_rate)}</Td>
                <Td className="num text-right">{pct(s.portfolio.confirm_rate)}</Td>
                {s.phase !== "pre_event" && <Td className="num text-right">{pct(s.portfolio.show_rate)}</Td>}
                <Td className="num text-right">{inr(s.portfolio.cost_per_confirmed)}</Td>
                {s.phase !== "pre_event" && <Td className="num text-right">{inr(s.portfolio.cost_per_attendee)}</Td>}
                <Td className="pr-4 text-right">100%</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Note>
        Verdict metric: {post ? "₹ per verified attendee and registered→attended rate (event is over)." : "₹ per confirmed registration and registered→confirmed rate (attendance is not observable before the event)."} The budget bar marker shows how much of the campaign&apos;s planned window has elapsed.
      </Note>

      {selected ? (
        <CampaignDetail asOf={asOf} q={q} selected={selected} meta={campaignMeta.get(selected.campaign_id)!} owners={cache.dataset.owners} allCampaigns={s.campaigns} ds={cache.dataset} post={post} />
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">Select a campaign to see its verdict reasoning, trends, tasks, and to edit budget, status or owner.</div>
      )}
    </div>
  );
}

async function CampaignDetail({ asOf, q, selected: c, meta, owners, allCampaigns, ds, post }: {
  asOf: string; q: string; post: boolean;
  selected: Awaited<ReturnType<typeof getSnapshot>>["snapshot"]["campaigns"][number];
  meta: { target_audience: string; objective: string; notes: string };
  owners: { owner_id: string; owner_name: string }[];
  allCampaigns: { campaign_id: string; campaign_name: string; budget_inr: number }[];
  ds: Awaited<ReturnType<typeof getSnapshot>>["cache"]["dataset"];
}) {
  const [tasks, regs, spend] = await Promise.all([
    listTasks({ campaignId: c.campaign_id }),
    Promise.resolve(computeTrend(ds, asOf, "registrations", c.campaign_id, "day")),
    Promise.resolve(computeTrend(ds, asOf, "spend", c.campaign_id, "day")),
  ]);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
      <Card
        className="xl:col-span-3"
        title={<span className="flex items-center gap-2">{c.campaign_name} <VerdictBadge call={c.verdict.call} /></span>}
        subtitle={`${c.campaign_id} · ${c.channel} · owner ${c.owner_name}`}
        action={<Link href={`/campaigns?${q}`} className="text-zinc-400 hover:text-zinc-700" aria-label="Close"><X className="h-4 w-4" /></Link>}
      >
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Why this verdict</div>
            <ul className="space-y-1 text-sm text-zinc-700">
              {c.verdict.reasons.map((r) => <li key={r}>• {r}</li>)}
              {c.flags.map((f) => <li key={f} className="text-amber-700">⚠ {f}</li>)}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-zinc-50 p-3 text-sm sm:grid-cols-4">
            <div><div className="text-[11px] text-zinc-500">Impressions (events)</div><div className="num font-semibold">{num(c.impressions)}</div></div>
            <div><div className="text-[11px] text-zinc-500">CTR</div><div className="num font-semibold">{pct(c.rates.ctr, 2)}</div></div>
            <div><div className="text-[11px] text-zinc-500">CPM</div><div className="num font-semibold">{inr(c.cost.cpm)}</div></div>
            <div><div className="text-[11px] text-zinc-500">₹ / identified</div><div className="num font-semibold">{inr(c.cost.per_identified)}</div></div>
            <div><div className="text-[11px] text-zinc-500">₹ / registered</div><div className="num font-semibold">{inr(c.cost.per_registered)}</div></div>
            <div><div className="text-[11px] text-zinc-500">Cancelled / waitlisted</div><div className="num font-semibold">{num(c.status_counts.cancelled)} / {num(c.status_counts.waitlisted)}</div></div>
            {post && <div><div className="text-[11px] text-zinc-500">Confirmed no-shows</div><div className="num font-semibold">{num(c.confirmed_no_shows)}</div></div>}
            <div><div className="text-[11px] text-zinc-500">Budget used</div><div className="num font-semibold">{pctUnits(c.budget_used_pct)}{c.plan_elapsed_pct !== null && <span className="font-normal text-zinc-500"> · plan {pctUnits(c.plan_elapsed_pct)}</span>}</div></div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-600">Registrations (daily, cumulative)</div>
              <DailyCumulativeChart points={regs.points} height={180} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-600">Spend (daily, cumulative) vs budget</div>
              <DailyCumulativeChart points={spend.points} goal={c.budget_inr} goalLabel={`Budget ${inr(c.budget_inr, { compact: true })}`} money color="#10b981" height={180} />
            </div>
          </div>
          <div className="text-xs text-zinc-500"><span className="font-medium text-zinc-600">Audience:</span> {meta.target_audience} <span className="ml-2 font-medium text-zinc-600">Objective:</span> {meta.objective}</div>
        </div>
      </Card>

      <div className="space-y-5 xl:col-span-2">
        <Card title="Manage campaign" subtitle="Changes are saved, logged in the activity log, and update all analytics.">
          <CampaignEditForm campaign={{ campaign_id: c.campaign_id, status: c.status, budget_inr: c.budget_inr, owner_id: c.owner_id, notes: meta.notes }} owners={owners} />
          <div className="mt-4 border-t border-zinc-100 pt-3">
            <div className="mb-1 text-xs font-medium text-zinc-600">Reallocate budget</div>
            <ReallocateForm fromId={c.campaign_id} campaigns={allCampaigns} />
          </div>
        </Card>
        <Card title={`Tasks (${tasks.length})`}>
          <TaskList tasks={tasks} owners={owners} asOf={asOf} compact />
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <QuickTaskForm campaignId={c.campaign_id} ownerId={c.owner_id} owners={owners} defaultDue={addDays(asOf, 7)} />
          </div>
        </Card>
      </div>
    </div>
  );
}
