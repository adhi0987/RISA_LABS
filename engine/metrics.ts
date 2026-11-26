// Verdict engine: thresholds and the scale / maintain / fix / stop rules (Slide 3 of the strategy deck).
import type { Settings, Thresholds } from "./types";

export const THRESHOLDS: Thresholds = {
  scaleMaxRatio: 1.0, // ₹ per confirmed (or per attendee) ≤ portfolio → SCALE
  fixMinRatio: 1.3, // > 130% of portfolio → FIX
  stopMinRatio: 1.75, // ≥ 175% of portfolio …
  stopDownFunnelGapPts: 15, // … AND down-funnel ≥ 15 pts below portfolio → STOP
  minConfirmedForVerdict: 15, // fewer confirmed registrations than this → WATCH (not enough evidence)
  paceTolerancePts: 15, // spend share ahead of plan-time share by more than this → overspending pace
};

export const DEFAULT_SETTINGS: Settings = {
  thresholds: THRESHOLDS,
  // Assumption: confirmed → attended band for pre-event projections (2025 ended at ~74% of registrants
  // with a final status of confirmed attending; band kept wide on purpose).
  showRateBand: { low: 0.65, mid: 0.72, high: 0.8 },
  walkInShare: 0.065, // 2025: 125 walk-ins ÷ 1,925 campaign attendees
};

export type VerdictCall = "scale" | "maintain" | "fix" | "stop" | "watch";

export type Verdict = {
  call: VerdictCall;
  metric: "cost_per_confirmed" | "cost_per_attendee";
  value: number | null;
  portfolio: number | null;
  ratio_pct: number | null;
  down_funnel_label: "registered→confirmed" | "registered→attended";
  down_funnel_rate: number | null;
  portfolio_down_funnel_rate: number | null;
  gap_pts: number | null;
  reasons: string[];
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const inr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;

export function computeVerdict(args: {
  postEvent: boolean;
  spend: number;
  confirmed: number;
  attended: number;
  registered: number;
  portfolioCost: number | null;
  portfolioDownFunnel: number | null;
  thresholds: Thresholds;
}): Verdict {
  const { postEvent, spend, confirmed, attended, registered, portfolioCost, portfolioDownFunnel, thresholds: t } = args;
  const metric = postEvent ? "cost_per_attendee" : "cost_per_confirmed";
  const denom = postEvent ? attended : confirmed;
  const value = denom > 0 ? spend / denom : null;
  const downFunnel = registered > 0 ? (postEvent ? attended : confirmed) / registered : null;
  const gap = downFunnel !== null && portfolioDownFunnel !== null ? (portfolioDownFunnel - downFunnel) * 100 : null;
  const ratio = value !== null && portfolioCost ? value / portfolioCost : null;
  const base = {
    metric,
    value,
    portfolio: portfolioCost,
    ratio_pct: ratio === null ? null : ratio * 100,
    down_funnel_label: postEvent ? "registered→attended" : "registered→confirmed",
    down_funnel_rate: downFunnel,
    portfolio_down_funnel_rate: portfolioDownFunnel,
    gap_pts: gap,
  } as const;
  const label = postEvent ? "per verified attendee" : "per confirmed registration";

  if (confirmed < t.minConfirmedForVerdict && !(postEvent && attended >= t.minConfirmedForVerdict)) {
    return {
      ...base,
      call: "watch",
      reasons: [`Only ${confirmed} confirmed registrations; below the ${t.minConfirmedForVerdict} needed for a verdict.`],
    };
  }
  if (ratio === null || value === null) {
    return { ...base, call: "watch", reasons: ["No conversions yet to price against spend."] };
  }
  const costLine = `${inr(value)} ${label} = ${pct(ratio)} of portfolio (${inr(portfolioCost!)})`;
  const funnelLine =
    downFunnel !== null && portfolioDownFunnel !== null
      ? `${base.down_funnel_label} ${pct(downFunnel)} vs portfolio ${pct(portfolioDownFunnel)} (${gap! >= 0 ? `${gap!.toFixed(1)} pts below` : `${(-gap!).toFixed(1)} pts above`})`
      : "down-funnel rate unavailable";

  if (ratio >= t.stopMinRatio && gap !== null && gap >= t.stopDownFunnelGapPts) {
    return {
      ...base,
      call: "stop",
      reasons: [costLine, funnelLine, `Both stop conditions met (≥${pct(t.stopMinRatio)} cost and ≥${t.stopDownFunnelGapPts} pts down-funnel gap).`],
    };
  }
  if (ratio > t.fixMinRatio) {
    const extra =
      ratio >= t.stopMinRatio
        ? `Cost is past the stop line, but the down-funnel gap is under ${t.stopDownFunnelGapPts} pts, so fix rather than stop.`
        : `Cost is above the ${pct(t.fixMinRatio)} fix line.`;
    return { ...base, call: "fix", reasons: [costLine, funnelLine, extra] };
  }
  if (ratio <= t.scaleMaxRatio) {
    return { ...base, call: "scale", reasons: [costLine, funnelLine, "At or below portfolio cost: candidate for more budget."] };
  }
  return { ...base, call: "maintain", reasons: [costLine, funnelLine, `Between ${pct(t.scaleMaxRatio)} and ${pct(t.fixMinRatio)} of portfolio cost.`] };
}

export function mergeSettings(overrides: Partial<Settings> | null | undefined): Settings {
  return {
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(overrides?.thresholds ?? {}) },
    showRateBand: { ...DEFAULT_SETTINGS.showRateBand, ...(overrides?.showRateBand ?? {}) },
    walkInShare: overrides?.walkInShare ?? DEFAULT_SETTINGS.walkInShare,
  };
}
