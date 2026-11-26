import { getDataset } from "@/lib/data/dataset";
import { listBets } from "@/lib/data/management";
import { computeSnapshot } from "@/engine/snapshot";
import { benchmarksFrom, DEFAULT_PLANNER_ASSUMPTIONS, runPlan, scoreBets } from "@/engine/planner";
import { Assumption, Badge, Card, Note, PageHeader, Stat, Td, Th } from "@/components/ui";
import { WaterfallChart } from "@/components/charts";
import { inr, num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const CALL_TONE = { double_down: "emerald", deprioritise: "amber", reject: "rose" } as const;
const CALL_LABEL = { double_down: "Double down", deprioritise: "Deprioritise", reject: "Reject" } as const;

export default async function PlannerPage() {
  const { dataset, settings } = await getDataset();
  const final = computeSnapshot(dataset, dataset.event.history_end, settings);
  const bench = benchmarksFrom(final);
  const base = runPlan("base", bench);
  const stretch = runPlan("stretch", bench);
  const bets = scoreBets(await listBets());
  const a = DEFAULT_PLANNER_ASSUMPTIONS;
  const waterfall = [
    { label: "Base", value: Math.round(base.totals.attendees), kind: "base" as const },
    ...bets.map((b) => ({ label: b.name.split(" ")[0] === "Ambassador" ? "Flywheel" : b.name.split(/[ :+→]/)[0], value: b.incremental_attendees, kind: b.incremental_attendees >= 0 ? ("up" as const) : ("down" as const) })),
    { label: "Stretch", value: Math.round(base.totals.attendees + bets.reduce((s, b) => s + b.incremental_attendees, 0)), kind: "total" as const },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="2026 Planner · Bengaluru"
        description={<>Reproduces the strategy deck&apos;s target model. Registration and show rates are <b>2025 actuals by channel</b> computed live from the dataset (so the plan re-bases if the data changes); reach drivers, uplifts and costs are <Assumption>{""}</Assumption> inputs.</>}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card><Stat label="Base case" value={num(Math.round(base.totals.attendees))} sub={<>{inr(base.totals.spend, { compact: true })} · {inr(base.totals.cost_per_attendee)} per attendee</>} /></Card>
        <Card><Stat label="Stretch target" value={<span className="text-indigo-700">{num(Math.round(stretch.totals.attendees))}</span>} sub={<>{inr(stretch.totals.spend, { compact: true })} · {inr(stretch.totals.cost_per_attendee)} per attendee</>} /></Card>
        <Card><Stat label="Venue ceiling" value={num(Math.round(base.capacity.ceiling))} sub={<>{num(a.capacity_per_day)}/day × {a.event_days} ÷ (1 + {pct(a.two_day_share)} two-day visitors)</>} /></Card>
        <Card><Stat label="2025 actual" value={num(final.totals.attended)} sub={<>{inr(final.totals.spend, { compact: true })} · {inr(final.portfolio.cost_per_attendee)} per attendee</>} /></Card>
      </div>

      <Card title="Target audiences: reach driver → funnel (base / stretch)" subtitle={`Spend = identified × 2025 cost per identified × ${a.inflation} Bengaluru inflation (paid and creator spend are inputs). Stretch adds Show-Up Engineering uplift to show-rates.`}>
        <div className="-mx-4 overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-zinc-200">
              <tr><Th className="pl-4">Segment</Th><Th>Reach driver (base → stretch)</Th><Th className="text-right">Identified</Th><Th className="text-right">Reg rate</Th><Th className="text-right">Show rate</Th><Th className="text-right">Attendees</Th><Th className="pr-4 text-right">Spend</Th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {base.segments.map((b, i) => {
                const s = stretch.segments[i];
                return (
                  <tr key={b.id}>
                    <Td className="pl-4"><div className="font-medium">{b.name}</div><div className="text-xs text-zinc-500">2025 benchmark: {b.campaign_id}</div></Td>
                    <Td className="text-xs text-zinc-600">{b.driver_label} → {s.driver_label}</Td>
                    <Td className="num text-right">{num(Math.round(b.identified))} / {num(Math.round(s.identified))}</Td>
                    <Td className="num text-right">{pct(b.reg_rate, 1)}</Td>
                    <Td className="num text-right">{pct(b.show_rate)} / {pct(s.show_rate)}</Td>
                    <Td className="num text-right font-semibold">{num(Math.round(b.attendees))} / {num(Math.round(s.attendees))}</Td>
                    <Td className="num pr-4 text-right">{inr(b.spend, { compact: true })} / {inr(s.spend, { compact: true })}</Td>
                  </tr>
                );
              })}
              <tr>
                <Td className="pl-4 text-zinc-600">Walk-ins</Td>
                <Td className="text-xs text-zinc-600">{pct(a.walk_in_share, 1)} of campaign attendees (2025)</Td>
                <Td /><Td /><Td />
                <Td className="num text-right">{num(Math.round(base.walk_ins))} / {num(Math.round(stretch.walk_ins))}</Td>
                <Td className="num pr-4 text-right text-xs text-zinc-500">+{inr(stretch.programme_costs, { compact: true })} programmes (stretch)</Td>
              </tr>
              <tr className="bg-zinc-50/60 font-semibold">
                <Td className="pl-4">Total</Td>
                <Td className="text-xs font-normal text-zinc-600">ceiling {num(Math.round(base.capacity.ceiling))} · stretch uses {pct(stretch.capacity.utilisation)}</Td>
                <Td className="num text-right">{num(Math.round(base.totals.identified))} / {num(Math.round(stretch.totals.identified))}</Td>
                <Td className="num text-right">{pct(base.totals.reg_rate)} / {pct(stretch.totals.reg_rate)}</Td>
                <Td className="num text-right">{pct(base.totals.show_rate)} / {pct(stretch.totals.show_rate)}</Td>
                <Td className="num text-right">{num(Math.round(base.totals.attendees))} / {num(Math.round(stretch.totals.attendees))}</Td>
                <Td className="num pr-4 text-right">{inr(base.totals.spend, { compact: true })} / {inr(stretch.totals.spend, { compact: true })}</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Five bets, ranked" subtitle="Priority score = incremental attendees × confidence ÷ cost (₹ lakh), computed live. Budget cuts are not scored.">
          <div className="-mx-4 overflow-x-auto">
            <table className="min-w-full">
              <thead><tr><Th className="pl-4">#</Th><Th>Bet</Th><Th>Call</Th><Th className="text-right">+Attendees</Th><Th className="text-right">Budget</Th><Th className="text-right">Confidence</Th><Th className="pr-4 text-right">Score</Th></tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {bets.map((b) => (
                  <tr key={b.bet_id}>
                    <Td className="pl-4 num">{b.rank}</Td>
                    <Td className="font-medium">{b.name}</Td>
                    <Td><Badge tone={CALL_TONE[b.call as keyof typeof CALL_TONE] ?? "zinc"}>{CALL_LABEL[b.call as keyof typeof CALL_LABEL] ?? b.call}</Badge></Td>
                    <Td className="num text-right">{b.incremental_attendees > 0 ? "+" : ""}{num(b.incremental_attendees)}</Td>
                    <Td className="num text-right">{inr(b.budget_inr, { compact: true })}</Td>
                    <Td className="num text-right">{b.confidence.toFixed(2)}</Td>
                    <Td className="num pr-4 text-right font-semibold">{b.score === null ? "—" : num(Math.round(b.score))}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>Confidence weights and programme costs are assumptions from the strategy deck. Overlap is handled by sequencing: referrals follow pods, and show-up is sized last because it multiplies every channel.</Note>
        </Card>
        <Card className="xl:col-span-2" title="Contribution waterfall (verified attendees)">
          <WaterfallChart steps={waterfall} />
        </Card>
      </div>
    </div>
  );
}
