"use client";
import { useState, useTransition } from "react";
import { addDailyAction, addTargetAction, appendStatusAction, deleteTargetAction, importDatasetAction, resetDatasetAction, updateDailyAction, type ActionResult } from "@/app/actions";
import { btnCls, btnGhost, inputCls, ResultLine } from "./campaign-forms";

export function DailyRowEditor({ row }: { row: { activity_id: string; impressions: number; clicks: number; landing_page_sessions: number; registration_starts: number; marketing_spend_inr: number } }) {
  const [v, setV] = useState({ impressions: String(row.impressions), clicks: String(row.clicks), landing_page_sessions: String(row.landing_page_sessions), registration_starts: String(row.registration_starts), marketing_spend_inr: String(row.marketing_spend_inr) });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const dirty = Object.entries(v).some(([k, x]) => Number(x) !== (row as unknown as Record<string, number>)[k]);
  const cell = (k: keyof typeof v, w = "w-24") => (
    <td className="px-1 py-1"><input className={`${inputCls} ${w} num py-1 text-right`} type="number" step="any" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></td>
  );
  return (
    <>
      {cell("impressions")}
      {cell("clicks", "w-20")}
      {cell("landing_page_sessions", "w-20")}
      {cell("registration_starts", "w-20")}
      {cell("marketing_spend_inr")}
      <td className="px-1 py-1">
        <div className="flex items-center gap-2">
          <button
            className={btnGhost + " py-1"}
            disabled={!dirty || pending}
            onClick={() => start(async () => setResult(await updateDailyAction(row.activity_id, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])))))}
          >
            {pending ? "…" : "Save"}
          </button>
          <ResultLine result={result} />
        </div>
      </td>
    </>
  );
}

export function AddDailyForm({ campaigns, defaultDate }: { campaigns: { campaign_id: string; campaign_name: string }[]; defaultDate: string }) {
  const [f, setF] = useState({ campaign_id: campaigns[0]?.campaign_id ?? "", activity_date: defaultDate, marketing_spend_inr: "0", impressions: "0", clicks: "0" });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => setResult(await addDailyAction({ campaign_id: f.campaign_id, activity_date: f.activity_date, marketing_spend_inr: Number(f.marketing_spend_inr), impressions: Number(f.impressions), clicks: Number(f.clicks) }))); }}>
      <label className="text-xs text-zinc-500">Campaign<select className={inputCls} value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}>{campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}</select></label>
      <label className="text-xs text-zinc-500">Date<input className={inputCls} type="date" value={f.activity_date} onChange={(e) => setF({ ...f, activity_date: e.target.value })} /></label>
      <label className="text-xs text-zinc-500">Spend ₹<input className={`${inputCls} w-28`} type="number" step="any" value={f.marketing_spend_inr} onChange={(e) => setF({ ...f, marketing_spend_inr: e.target.value })} /></label>
      <label className="text-xs text-zinc-500">Impressions<input className={`${inputCls} w-28`} type="number" min={0} value={f.impressions} onChange={(e) => setF({ ...f, impressions: e.target.value })} /></label>
      <label className="text-xs text-zinc-500">Clicks<input className={`${inputCls} w-24`} type="number" min={0} value={f.clicks} onChange={(e) => setF({ ...f, clicks: e.target.value })} /></label>
      <button className={btnCls} disabled={pending}>{pending ? "Adding…" : "Add daily row"}</button>
      <ResultLine result={result} />
    </form>
  );
}

export function TargetVersionForm({ current, defaultEffective }: { current: { identified_external_people_goal: number; registration_goal: number; unique_external_visitors_goal: number; marketing_budget_inr: number } | null; defaultEffective: string }) {
  const [f, setF] = useState({
    target_version: "Revised plan (edited in app)",
    effective_at: defaultEffective,
    identified_external_people_goal: String(current?.identified_external_people_goal ?? 0),
    registration_goal: String(current?.registration_goal ?? 0),
    unique_external_visitors_goal: String(current?.unique_external_visitors_goal ?? 0),
    marketing_budget_inr: String(current?.marketing_budget_inr ?? 0),
  });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const num = (k: keyof typeof f, label: string) => (
    <label className="text-xs text-zinc-500">{label}<input className={`${inputCls} num`} type="number" min={0} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <form
      className="grid grid-cols-2 gap-2 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await addTargetAction({
          target_version: f.target_version,
          effective_at: new Date(`${f.effective_at}:00+05:30`).toISOString(),
          identified_external_people_goal: Number(f.identified_external_people_goal),
          registration_goal: Number(f.registration_goal),
          unique_external_visitors_goal: Number(f.unique_external_visitors_goal),
          marketing_budget_inr: Number(f.marketing_budget_inr),
        })));
      }}
    >
      <label className="col-span-2 text-xs text-zinc-500">Version label<input className={inputCls} value={f.target_version} onChange={(e) => setF({ ...f, target_version: e.target.value })} /></label>
      <label className="col-span-2 text-xs text-zinc-500 md:col-span-1">Effective (IST)<input className={inputCls} type="datetime-local" value={f.effective_at} onChange={(e) => setF({ ...f, effective_at: e.target.value })} /></label>
      {num("identified_external_people_goal", "Identified goal")}
      {num("registration_goal", "Registration goal")}
      {num("unique_external_visitors_goal", "Visitors goal")}
      {num("marketing_budget_inr", "Budget ₹")}
      <div className="col-span-2 flex items-end gap-2">
        <button className={btnCls} disabled={pending}>{pending ? "Saving…" : "Add target version"}</button>
        <ResultLine result={result} />
      </div>
    </form>
  );
}

export function DeleteTargetButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button className="text-xs text-rose-600 hover:underline disabled:opacity-50" disabled={pending} onClick={() => start(async () => setResult(await deleteTargetAction(id)))}>Delete</button>
      <ResultLine result={result && !result.ok ? result : null} />
    </span>
  );
}

export function StatusAppendForm({ registrationId, defaultAt }: { registrationId: string; defaultAt: string }) {
  const [status, setStatus] = useState("cancelled");
  const [at, setAt] = useState(defaultAt);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => setResult(await appendStatusAction(registrationId, status as never, new Date(`${at}:00+05:30`).toISOString()))); }}>
      <label className="text-xs text-zinc-500">New status<select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>{["interested", "confirmed", "cancelled", "waitlisted"].map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="text-xs text-zinc-500">Effective (IST)<input className={inputCls} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <button className={btnCls} disabled={pending}>{pending ? "Saving…" : "Append status version"}</button>
      <ResultLine result={result} />
    </form>
  );
}

export function ResetImportPanel() {
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => setResult(await resetDatasetAction(confirmText))); }}>
        <div className="text-sm font-medium text-zinc-800">Reset to the original 2025 dataset</div>
        <p className="text-xs text-zinc-500">Reloads every source table from the bundled original workbook and resets campaign budgets and statuses. Tasks and the activity log are kept.</p>
        <div className="flex gap-2">
          <input className={`${inputCls} w-40`} placeholder="Type RESET" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          <button className={btnGhost} disabled={pending || confirmText !== "RESET"}>{pending ? "Resetting…" : "Reset data"}</button>
        </div>
      </form>
      <form className="space-y-2" action={(fd) => start(async () => setResult(await importDatasetAction(fd)))}>
        <div className="text-sm font-medium text-zinc-800">Import a changed workbook</div>
        <p className="text-xs text-zinc-500">Upload an .xlsx with the same sheets as the original (Event, Targets, Campaigns, Daily Marketing, People, Interest and Engagement, Registrations, Registration History, Check-ins). It replaces the source tables.</p>
        <div className="flex gap-2">
          <input name="file" type="file" accept=".xlsx" className="text-xs" required />
          <button className={btnGhost} disabled={pending}>{pending ? "Importing…" : "Import"}</button>
        </div>
      </form>
      <div className="md:col-span-2"><ResultLine result={result} /></div>
    </div>
  );
}
