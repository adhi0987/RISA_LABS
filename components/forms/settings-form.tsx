"use client";
import { useState, useTransition } from "react";
import { saveSettingsAction, type ActionResult } from "@/app/actions";
import type { Settings } from "@/engine/types";
import { btnCls, btnGhost, inputCls, ResultLine } from "./campaign-forms";

export function SettingsForm({ settings, defaults }: { settings: Settings; defaults: Settings }) {
  const [s, setS] = useState(settings);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const t = s.thresholds;
  const setT = (k: keyof Settings["thresholds"], v: string) => setS({ ...s, thresholds: { ...t, [k]: Number(v) } });
  const field = (label: string, value: number, onChange: (v: string) => void, step = "0.01", hint?: string) => (
    <label className="text-xs text-zinc-500">
      {label}
      <input className={`${inputCls} num`} type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="text-[10px] text-zinc-400">{hint}</span>}
    </label>
  );
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => setResult(await saveSettingsAction(s))); }}>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Verdict thresholds (ratio to portfolio cost)</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {field("Scale if cost ≤", t.scaleMaxRatio, (v) => setT("scaleMaxRatio", v), "0.05", "1.00 = portfolio")}
          {field("Fix if cost >", t.fixMinRatio, (v) => setT("fixMinRatio", v), "0.05")}
          {field("Stop if cost ≥", t.stopMinRatio, (v) => setT("stopMinRatio", v), "0.05")}
          {field("…and down-funnel gap ≥ (pts)", t.stopDownFunnelGapPts, (v) => setT("stopDownFunnelGapPts", v), "1")}
          {field("Min confirmed for a verdict", t.minConfirmedForVerdict, (v) => setT("minConfirmedForVerdict", v), "1")}
          {field("Pacing tolerance (pts)", t.paceTolerancePts, (v) => setT("paceTolerancePts", v), "1")}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Projection assumptions</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {field("Show-rate low", s.showRateBand.low, (v) => setS({ ...s, showRateBand: { ...s.showRateBand, low: Number(v) } }))}
          {field("Show-rate mid", s.showRateBand.mid, (v) => setS({ ...s, showRateBand: { ...s.showRateBand, mid: Number(v) } }))}
          {field("Show-rate high", s.showRateBand.high, (v) => setS({ ...s, showRateBand: { ...s.showRateBand, high: Number(v) } }))}
          {field("Walk-in share", s.walkInShare, (v) => setS({ ...s, walkInShare: Number(v) }), "0.005")}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className={btnCls} disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
        <button type="button" className={btnGhost} onClick={() => setS(defaults)}>Restore defaults</button>
        <ResultLine result={result} />
      </div>
    </form>
  );
}
