import { getDataset } from "@/lib/data/dataset";
import { computeSnapshot } from "@/engine/snapshot";
import { DEFAULT_SETTINGS } from "@/engine/metrics";
import { addDays, msToIstDate } from "@/engine/time";
import { Card, Note, PageHeader, Td, Th, VerdictBadge } from "@/components/ui";
import { SettingsForm } from "@/components/forms/settings-form";
import { inr, pctUnits } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { dataset, settings } = await getDataset();
  const eventDay = msToIstDate(dataset.event.event_starts_at);
  const points = [
    { label: "T-28", date: addDays(eventDay, -28) },
    { label: "T-14", date: addDays(eventDay, -14) },
    { label: "T-7", date: addDays(eventDay, -7) },
    { label: "Final", date: dataset.event.history_end },
  ];
  const snaps = points.map((p) => ({ ...p, s: computeSnapshot(dataset, p.date, settings) }));
  const t = settings.thresholds;

  return (
    <div className="space-y-5">
      <PageHeader title="Rules & backtest" description="The verdict engine's rules, editable thresholds, and a replay of the verdicts at earlier snapshot dates. Each snapshot only sees data known by that day." />

      <Card title="How verdicts are decided">
        <ul className="space-y-1 text-sm text-zinc-700">
          <li>• <b>Cost metric</b>: ₹ per confirmed registration before the event (attendance not yet observable); ₹ per verified attendee after it. Compared with the portfolio (all campaigns).</li>
          <li>• <VerdictBadge call="scale" /> cost ≤ {Math.round(t.scaleMaxRatio * 100)}% of portfolio · <VerdictBadge call="maintain" /> between · <VerdictBadge call="fix" /> cost &gt; {Math.round(t.fixMinRatio * 100)}%</li>
          <li>• <VerdictBadge call="stop" /> cost ≥ {Math.round(t.stopMinRatio * 100)}% <b>and</b> down-funnel ≥ {t.stopDownFunnelGapPts} pts below portfolio (registered→confirmed before the event, registered→attended after).</li>
          <li>• <VerdictBadge call="watch" /> fewer than {t.minConfirmedForVerdict} confirmed registrations: not enough evidence yet.</li>
          <li>• Flags: over budget, or budget used more than {t.paceTolerancePts} pts ahead of the campaign&apos;s planned time elapsed.</li>
        </ul>
      </Card>

      <Card title="Backtest: verdicts replayed on earlier snapshots" subtitle="The leading indicator (₹ per confirmed) flagged Creators and Paid Social before any attendance data existed; both finished at a 50% show-rate.">
        <div className="-mx-4 overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-zinc-200">
              <tr>
                <Th className="pl-4">Campaign</Th>
                {snaps.map((p) => <Th key={p.label}>{p.label} · {p.date}</Th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {dataset.campaigns.map((c) => (
                <tr key={c.campaign_id}>
                  <Td className="pl-4 font-medium">{c.campaign_name}</Td>
                  {snaps.map((p) => {
                    const m = p.s.campaigns.find((x) => x.campaign_id === c.campaign_id)!;
                    return (
                      <Td key={p.label}>
                        <VerdictBadge call={m.verdict.call} />{" "}
                        <span className="num text-xs text-zinc-600">{inr(m.verdict.value)} ({pctUnits(m.verdict.ratio_pct)})</span>
                      </Td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-zinc-50/60">
                <Td className="pl-4 text-xs text-zinc-500">Portfolio</Td>
                {snaps.map((p) => <Td key={p.label} className="num text-xs text-zinc-600">{inr(p.s.phase === "post_event" ? p.s.portfolio.cost_per_attendee : p.s.portfolio.cost_per_confirmed)} {p.s.phase === "post_event" ? "per attendee" : "per confirmed"}</Td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Thresholds and assumptions" subtitle="Saved values apply to the dashboard and the AI analyst immediately.">
        <SettingsForm settings={settings} defaults={DEFAULT_SETTINGS} />
      </Card>
      <Note>Defaults live in engine/metrics.ts (THRESHOLDS, DEFAULT_SETTINGS). The show-rate band and walk-in share are planning assumptions, not source data.</Note>
    </div>
  );
}
