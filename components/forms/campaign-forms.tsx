"use client";
import { useState, useTransition } from "react";
import { updateCampaignAction, reallocateBudgetAction, createTaskAction, type ActionResult } from "@/app/actions";

export const inputCls = "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
export const btnCls = "inline-flex items-center justify-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50";
export const btnGhost = "inline-flex items-center justify-center gap-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50";

export function ResultLine({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return <div className={`text-xs ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>{result.ok ? result.message ?? "Saved" : result.error}</div>;
}

type Owner = { owner_id: string; owner_name: string };

export function CampaignEditForm({ campaign, owners }: { campaign: { campaign_id: string; status: string; budget_inr: number; owner_id: string; notes: string }; owners: Owner[] }) {
  const [status, setStatus] = useState(campaign.status);
  const [budget, setBudget] = useState(String(campaign.budget_inr));
  const [owner, setOwner] = useState(campaign.owner_id);
  const [notes, setNotes] = useState(campaign.notes);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await updateCampaignAction(campaign.campaign_id, { status: status as never, budget_inr: Number(budget), owner_id: owner, notes })));
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-zinc-500">
          Status
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {["active", "paused", "stopped", "planned"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Budget (₹)
          <input className={inputCls} type="number" min={0} step={100} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <label className="text-xs text-zinc-500">
          Owner
          <select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
            {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs text-zinc-500">
        Notes
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, decisions, links…" />
      </label>
      <div className="flex items-center gap-3">
        <button className={btnCls} disabled={pending}>{pending ? "Saving…" : "Save campaign"}</button>
        <ResultLine result={result} />
      </div>
    </form>
  );
}

export function ReallocateForm({ fromId, campaigns }: { fromId: string; campaigns: { campaign_id: string; campaign_name: string; budget_inr: number }[] }) {
  const [to, setTo] = useState(campaigns.find((c) => c.campaign_id !== fromId)?.campaign_id ?? "");
  const [amount, setAmount] = useState("5000");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await reallocateBudgetAction(fromId, to, Number(amount))));
      }}
    >
      <label className="text-xs text-zinc-500">
        Move ₹
        <input className={`${inputCls} w-28`} type="number" min={100} step={100} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="text-xs text-zinc-500">
        to
        <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
          {campaigns.filter((c) => c.campaign_id !== fromId).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
        </select>
      </label>
      <button className={btnGhost} disabled={pending}>{pending ? "Moving…" : "Move budget"}</button>
      <ResultLine result={result} />
    </form>
  );
}

export function QuickTaskForm({ campaignId, ownerId, owners, defaultDue }: { campaignId: string | null; ownerId: string | null; owners: Owner[]; defaultDue: string }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(ownerId ?? "");
  const [due, setDue] = useState(defaultDue);
  const [priority, setPriority] = useState("medium");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createTaskAction({ title, owner_id: owner || null, due_date: due || null, campaign_id: campaignId, priority: priority as never });
          setResult(r);
          if (r.ok) setTitle("");
        });
      }}
    >
      <label className="min-w-56 flex-1 text-xs text-zinc-500">
        New task
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Switch creator deals to pay-per-attendee" required minLength={3} />
      </label>
      <label className="text-xs text-zinc-500">
        Owner
        <select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Unassigned</option>
          {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
        </select>
      </label>
      <label className="text-xs text-zinc-500">
        Due
        <input className={inputCls} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <label className="text-xs text-zinc-500">
        Priority
        <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
          {["high", "medium", "low"].map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <button className={btnCls} disabled={pending}>{pending ? "Adding…" : "Add task"}</button>
      <ResultLine result={result} />
    </form>
  );
}
