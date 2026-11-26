import Link from "next/link";
import { AlertTriangle, ArrowRight, TrendingDown } from "lucide-react";
import { getSnapshot } from "@/lib/data/dataset";
import { computeTrend } from "@/engine/series";
import { Badge, Card, Note, PageHeader, Progress, Stat, VerdictBadge, Assumption } from "@/components/ui";
import { DailyCumulativeChart } from "@/components/charts";
import { inr, longDate, num, pct, pctUnits } from "@/lib/format";
import type { VerdictCall } from "@/engine/metrics";

export const dynamic = "force-dynamic";

const PHASE_LABEL = { pre_event: "Pre-event", event_live: "Event in progress", post_event: "Post-event" } as const;

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const { snapshot: s, cache, asOf } = await getSnapshot(typeof sp.asOf === "string" ? sp.asOf : null);
  const regTrend = computeTrend(cache.dataset, asOf, "registrations", null, "day");
  const spendTrend = computeTrend(cache.dataset, asOf, "spend", null, "day");
  const q = `?asOf=${asOf}`;
  const t = s.totals;
  const prog = Object.fromEntries(s.target_progress.map((p) => [p.metric, p]));

  const funnel = [
    { label: "Identified (campaign-sourced)", value: t.identified_via_campaign, note: "distinct external people" },
    { label: "Registered", value: t.registered, note: "distinct external people" },
    { label: "Confirmed (latest status)", value: t.confirmed, note: "as of this date" },
    ...(s.phase !== "pre_event" ? [{ label: "Verified attendees", value: t.attended, note: `incl. ${num(t.walk_ins)} walk-ins` }] : []),
  ];
  const maxF = Math.max(...funnel.map((f) => f.value), 1);
  const groups: VerdictCall[] = ["stop", "fix", "watch", "maintain", "scale"];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description={
          <>
            {longDate(asOf)} · <Badge tone={s.phase === "post_event" ? "zinc" : s.phase === "event_live" ? "amber" : "indigo"}>{PHASE_LABEL[s.phase]}</Badge>
            {s.phase === "pre_event" && <> · {s.days_to_event} days to the event</>} · Target plan: <span className="font-medium text-zinc-700">{s.target?.target_version ?? "none yet"}</span>
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["identified", "registered", "visitors"] as const).map((k) => {
          const p = prog[k];
          if (!p) return null;
          const isVisitors = k === "visitors";
          if (isVisitors && s.phase === "pre_event") {
            const mid = s.projection.attendees_mid;
            return (
              <Card key={k}>
                <Stat
                  label="Verified external visitors (projected)"
                  value={<span className="text-zinc-700">~{num(mid)}</span>}
                  sub={<>Goal {num(p.goal)} · range {num(s.projection.attendees_low)}–{num(s.projection.attendees_high)} · observed on event day</>}
                  tone={mid >= p.goal ? "good" : "bad"}
                />
                <div className="mt-3">
                  <Progress value={(mid / p.goal) * 100} tone={mid >= p.goal ? "emerald" : "amber"} />
                </div>
                <div className="mt-2 text-xs text-zinc-500">Mid case is {mid >= p.goal ? "+" : ""}{num(mid - p.goal)} vs goal (run-rate projection)</div>
              </Card>
            );
          }
          return (
            <Card key={k}>
              <Stat
                label={p.label}
                value={num(p.actual)}
                sub={
                  <>
                    Goal {num(p.goal)} · {pctUnits(p.pct_of_goal)} of goal
                    {p.expected_by_now !== null && <> · pace {num(Math.round(p.expected_by_now))}</>}
                  </>
                }
                tone={p.on_track === null ? "neutral" : p.on_track ? "good" : "bad"}
              />
              <div className="mt-3">
                <Progress value={p.pct_of_goal} marker={p.expected_by_now !== null && p.goal ? (p.expected_by_now / p.goal) * 100 : null} tone={p.on_track === false ? "rose" : "indigo"} />
              </div>
              {isVisitors && s.phase !== "post_event" && (
                <div className="mt-2 text-xs text-zinc-500">
                  Projected {num(s.projection.attendees_low)}–{num(s.projection.attendees_high)} (mid {num(s.projection.attendees_mid)})
                </div>
              )}
            </Card>
          );
        })}
        {prog.spend && (
          <Card>
            <Stat label="Marketing spend vs budget" value={inr(t.spend, { compact: true })} sub={<>Budget {inr(prog.spend.goal, { compact: true })} · {pctUnits(prog.spend.pct_of_goal)} used</>} tone={prog.spend.actual > prog.spend.goal ? "bad" : "neutral"} />
            <div className="mt-3">
              <Progress value={prog.spend.pct_of_goal} tone={prog.spend.actual > prog.spend.goal ? "rose" : "emerald"} />
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              {s.phase === "post_event" ? <>₹ per verified attendee: <span className="font-medium text-zinc-700">{inr(s.portfolio.cost_per_attendee)}</span></> : <>₹ per confirmed: <span className="font-medium text-zinc-700">{inr(s.portfolio.cost_per_confirmed)}</span></>}
            </div>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        {/* Funnel */}
        <Card className="xl:col-span-3" title="Growth funnel" subtitle="Person-level stages are distinct external people. Platform counts above them are anonymous events, not people.">
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-zinc-50 p-3 sm:grid-cols-4">
            {[
              ["Impressions", t.impressions],
              ["Clicks", t.clicks],
              ["Landing sessions", t.sessions],
              ["Form starts", t.registration_starts],
            ].map(([l, v]) => (
              <div key={l as string}>
                <div className="text-[11px] text-zinc-500">{l} <span className="text-zinc-400">(events)</span></div>
                <div className="num text-sm font-semibold text-zinc-700">{num(v as number)}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2.5">
            {funnel.map((f, i) => {
              const prev = i > 0 ? funnel[i - 1].value : null;
              return (
                <div key={f.label}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="text-zinc-700">{f.label} <span className="text-xs text-zinc-400">· {f.note}</span></span>
                    <span className="num font-semibold">
                      {num(f.value)}
                      {prev ? <span className="ml-2 text-xs font-normal text-zinc-500">{pct(f.value / prev)} of previous</span> : null}
                    </span>
                  </div>
                  <div className="h-6 rounded bg-zinc-100">
                    <div className="h-6 rounded bg-indigo-500/80" style={{ width: `${(f.value / maxF) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-3 text-xs text-zinc-600 sm:grid-cols-4">
            <div>Cancelled <span className="num font-semibold text-zinc-800">{num(t.status_counts.cancelled)}</span></div>
            <div>Waitlisted <span className="num font-semibold text-zinc-800">{num(t.status_counts.waitlisted)}</span></div>
            <div>Still “interested” <span className="num font-semibold text-zinc-800">{num(t.status_counts.interested)}</span></div>
            {s.phase !== "pre_event" ? (
              <div>No-shows <span className="num font-semibold text-zinc-800">{num(t.no_shows)}</span> ({num(t.confirmed_no_shows)} confirmed)</div>
            ) : (
              <div>Walk-ins <span className="text-zinc-400">after event</span></div>
            )}
          </div>
        </Card>

        {/* Bottleneck + projection */}
        <div className="space-y-5 xl:col-span-2">
          <Card title={<span className="flex items-center gap-1.5"><TrendingDown className="h-4 w-4 text-rose-500" /> Bottleneck finder</span>} subtitle="Stage with the largest loss, and campaigns losing more people than the portfolio rate would.">
            <div className="space-y-1.5">
              {s.bottleneck.stages.map((st) => (
                <div key={st.stage} className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${st.stage === s.bottleneck.worst_stage ? "bg-rose-50 text-rose-800" : "text-zinc-700"}`}>
                  <span>{st.stage}</span>
                  <span className="num">
                    lost <span className="font-semibold">{num(st.lost)}</span> ({pct(st.loss_rate)})
                  </span>
                </div>
              ))}
            </div>
            {s.bottleneck.campaign_excess_loss.length > 0 && (
              <div className="mt-3 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Excess loss vs portfolio rate</div>
                {s.bottleneck.campaign_excess_loss.slice(0, 4).map((e) => (
                  <div key={e.campaign_id + e.stage} className="flex justify-between text-xs text-zinc-600">
                    <Link href={`/campaigns${q}&c=${e.campaign_id}`} className="hover:text-indigo-600 hover:underline">{e.campaign_name}</Link>
                    <span className="num">
                      {e.stage}: {pct(e.campaign_rate)} vs {pct(e.portfolio_rate)} → <span className="font-semibold text-rose-700">−{num(e.excess_people_lost)} people</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Projection" subtitle={s.projection.basis === "actual" ? "Event over: observed result." : "Run-rate projection to event day, with a show-rate band."}>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[["Low", s.projection.attendees_low], ["Mid", s.projection.attendees_mid], ["High", s.projection.attendees_high]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-zinc-50 py-2">
                  <div className="text-[11px] text-zinc-500">{l}</div>
                  <div className="num text-lg font-semibold">{num(v as number)}</div>
                </div>
              ))}
            </div>
            {s.projection.visitors_goal ? (
              <div className="mt-2 text-xs text-zinc-600">
                Visitors goal {num(s.projection.visitors_goal)} → mid case is{" "}
                <span className={s.projection.attendees_mid >= s.projection.visitors_goal ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                  {s.projection.attendees_mid >= s.projection.visitors_goal ? "+" : ""}
                  {num(s.projection.attendees_mid - s.projection.visitors_goal)}
                </span>{" "}
                vs goal.
              </div>
            ) : null}
            <ul className="mt-2 space-y-0.5">
              {s.projection.assumptions.map((a) => (
                <li key={a} className="text-[11px] text-zinc-500">• {a}</li>
              ))}
            </ul>
            {s.projection.basis === "run_rate" && <div className="mt-1"><Assumption>show-rate band</Assumption></div>}
          </Card>
        </div>
      </div>

      {/* Verdict board */}
      <Card
        title="Campaign verdicts"
        subtitle={`Each campaign's ${s.phase === "post_event" ? "₹ per verified attendee" : "₹ per confirmed registration"} vs the portfolio, plus its down-funnel rate. Rules on the Rules & backtest page.`}
        action={<Link href={`/campaigns${q}`} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">All campaigns <ArrowRight className="h-3 w-3" /></Link>}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.flatMap((g) =>
            s.campaigns
              .filter((c) => c.verdict.call === g)
              .map((c) => (
                <Link key={c.campaign_id} href={`/campaigns${q}&c=${c.campaign_id}`} className="rounded-lg border border-zinc-200 p-3 hover:border-indigo-300 hover:bg-indigo-50/30">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{c.campaign_name}</div>
                    <VerdictBadge call={c.verdict.call} />
                  </div>
                  <div className="num mt-1 text-xs text-zinc-600">
                    {inr(c.verdict.value)} {s.phase === "post_event" ? "per attendee" : "per confirmed"} · {pctUnits(c.verdict.ratio_pct)} of portfolio · {c.owner_name}
                  </div>
                  {c.flags.length > 0 && (
                    <div className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {c.flags[0]}
                    </div>
                  )}
                </Link>
              )),
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Registrations per day" subtitle="Bars: new external registrations that day. Line: cumulative vs registration goal.">
          <DailyCumulativeChart points={regTrend.points} goal={s.target?.registration_goal} goalLabel={`Registration goal ${num(s.target?.registration_goal ?? 0)}`} />
        </Card>
        <Card title="Marketing spend" subtitle="Net posted spend per day (credits are negative) and cumulative vs approved budget.">
          <DailyCumulativeChart points={spendTrend.points} goal={s.target?.marketing_budget_inr} goalLabel={`Budget ${inr(s.target?.marketing_budget_inr ?? 0, { compact: true })}`} money color="#10b981" />
        </Card>
      </div>

      <Note>
        Data notes for this snapshot: {num(s.data_notes.non_external_admissions)} admissions by internal/staff/test people and {num(s.data_notes.denied_or_pending_checkins)} denied or pending check-ins are excluded from attendance.
        Attribution: registrations and attendance use the campaign recorded on the registration; walk-ins are unattributed (not zero-cost). Duplicated import rows are counted once.
      </Note>
    </div>
  );
}
