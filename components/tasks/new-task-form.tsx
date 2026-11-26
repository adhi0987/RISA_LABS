"use client";
import { useState, useTransition } from "react";
import { createTaskAction, type ActionResult } from "@/app/actions";
import { btnCls, inputCls, ResultLine } from "@/components/forms/campaign-forms";

export function NewTaskForm({ owners, campaigns, bets, defaultDue }: { owners: { owner_id: string; owner_name: string }[]; campaigns: { campaign_id: string; campaign_name: string }[]; bets: { bet_id: string; name: string }[]; defaultDue: string }) {
  const [f, setF] = useState({ title: "", description: "", owner_id: "", campaign_id: "", bet_id: "", due_date: defaultDue, priority: "medium" });
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid grid-cols-1 gap-2 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createTaskAction({ ...f, owner_id: f.owner_id || null, campaign_id: f.campaign_id || null, bet_id: f.bet_id || null, due_date: f.due_date || null, priority: f.priority as never });
          setResult(r);
          if (r.ok) setF({ ...f, title: "", description: "" });
        });
      }}
    >
      <input className={`${inputCls} md:col-span-3`} placeholder="Task title" value={f.title} onChange={set("title")} required minLength={3} />
      <select className={inputCls} value={f.owner_id} onChange={set("owner_id")} aria-label="Owner">
        <option value="">Unassigned</option>
        {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
      </select>
      <input className={inputCls} type="date" value={f.due_date} onChange={set("due_date")} aria-label="Due date" />
      <select className={inputCls} value={f.priority} onChange={set("priority")} aria-label="Priority">
        {["high", "medium", "low"].map((p) => <option key={p}>{p}</option>)}
      </select>
      <input className={`${inputCls} md:col-span-3`} placeholder="Description (optional)" value={f.description} onChange={set("description")} />
      <select className={inputCls} value={f.campaign_id} onChange={set("campaign_id")} aria-label="Campaign">
        <option value="">No campaign</option>
        {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
      </select>
      <select className={inputCls} value={f.bet_id} onChange={set("bet_id")} aria-label="Bet">
        <option value="">No bet</option>
        {bets.map((b) => <option key={b.bet_id} value={b.bet_id}>{b.name}</option>)}
      </select>
      <div className="flex items-center gap-2">
        <button className={btnCls} disabled={pending}>{pending ? "Adding…" : "Add task"}</button>
        <ResultLine result={result} />
      </div>
    </form>
  );
}
