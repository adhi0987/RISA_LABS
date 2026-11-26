"use client";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Bot, Pencil, Trash2 } from "lucide-react";
import { deleteTaskAction, updateTaskAction, type ActionResult } from "@/app/actions";
import { inputCls, btnCls, btnGhost, ResultLine } from "@/components/forms/campaign-forms";

type Task = {
  id: number; title: string; description: string; campaign_id: string | null; campaign_name: string | null; bet_id: string | null; bet_name: string | null;
  owner_id: string | null; owner_name: string | null; due_date: string | null; status: "todo" | "doing" | "blocked" | "done"; priority: "high" | "medium" | "low"; source: string;
};
type Owner = { owner_id: string; owner_name: string };

const STATUS_STYLE = { todo: "bg-zinc-100 text-zinc-700", doing: "bg-sky-50 text-sky-700", blocked: "bg-rose-50 text-rose-700", done: "bg-emerald-50 text-emerald-700" } as const;
const PRIORITY_STYLE = { high: "text-rose-600", medium: "text-amber-600", low: "text-zinc-400" } as const;

export function TaskList({ tasks, owners, asOf, compact = false, campaigns, bets }: { tasks: Task[]; owners: Owner[]; asOf: string; compact?: boolean; campaigns?: { campaign_id: string; campaign_name: string }[]; bets?: { bet_id: string; name: string }[] }) {
  if (tasks.length === 0) return <div className="py-3 text-center text-sm text-zinc-500">No tasks yet.</div>;
  return (
    <ul className="divide-y divide-zinc-100">
      {tasks.map((t) => <TaskItem key={t.id} t={t} owners={owners} asOf={asOf} compact={compact} campaigns={campaigns} bets={bets} />)}
    </ul>
  );
}

function TaskItem({ t, owners, asOf, compact, campaigns, bets }: { t: Task; owners: Owner[]; asOf: string; compact: boolean; campaigns?: { campaign_id: string; campaign_name: string }[]; bets?: { bet_id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [editing, setEditing] = useState(false);
  const overdue = t.due_date !== null && t.due_date < asOf && t.status !== "done";
  const patch = (p: Record<string, unknown>) => start(async () => setResult(await updateTaskAction(t.id, p)));

  return (
    <li className={clsx("py-2.5", pending && "opacity-60")}>
      <div className="flex items-start gap-2">
        <select
          aria-label="Status"
          className={clsx("mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase", STATUS_STYLE[t.status])}
          value={t.status}
          onChange={(e) => patch({ status: e.target.value })}
        >
          {["todo", "doing", "blocked", "done"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="min-w-0 flex-1">
          <div className={clsx("text-sm", t.status === "done" ? "text-zinc-400 line-through" : "text-zinc-900")}>
            <span className={clsx("mr-1 text-xs font-bold", PRIORITY_STYLE[t.priority])} title={`${t.priority} priority`}>{t.priority === "high" ? "!!" : t.priority === "medium" ? "!" : "·"}</span>
            {t.title}
            {t.source === "ai" && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 py-0.5 align-middle text-[10px] font-medium text-violet-700"><Bot className="h-3 w-3" />AI</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <select aria-label="Owner" className="rounded border border-transparent bg-transparent hover:border-zinc-200" value={t.owner_id ?? ""} onChange={(e) => patch({ owner_id: e.target.value || null })}>
              <option value="">Unassigned</option>
              {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
            </select>
            <span>·</span>
            <input aria-label="Due date" type="date" className={clsx("rounded border border-transparent bg-transparent hover:border-zinc-200", overdue && "font-semibold text-rose-600")} value={t.due_date ?? ""} onChange={(e) => patch({ due_date: e.target.value || null })} />
            {overdue && <span className="font-medium text-rose-600">overdue vs {asOf}</span>}
            {!compact && t.campaign_name && <span className="rounded bg-zinc-100 px-1.5">{t.campaign_name}</span>}
            {!compact && t.bet_name && <span className="rounded bg-indigo-50 px-1.5 text-indigo-700">{t.bet_name}</span>}
          </div>
          {t.description && !editing && <div className="mt-1 text-xs text-zinc-600">{t.description}</div>}
          {editing && <EditTask t={t} campaigns={campaigns} bets={bets} onDone={() => setEditing(false)} />}
          <ResultLine result={result && !result.ok ? result : null} />
        </div>
        <div className="flex shrink-0 gap-1">
          <button className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="Edit" onClick={() => setEditing((v) => !v)}><Pencil className="h-3.5 w-3.5" /></button>
          <button
            className="rounded p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
            title="Delete"
            onClick={() => { if (confirm(`Delete task “${t.title}”?`)) start(async () => setResult(await deleteTaskAction(t.id))); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

function EditTask({ t, campaigns, bets, onDone }: { t: Task; campaigns?: { campaign_id: string; campaign_name: string }[]; bets?: { bet_id: string; name: string }[]; onDone: () => void }) {
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description);
  const [priority, setPriority] = useState(t.priority);
  const [campaign, setCampaign] = useState(t.campaign_id ?? "");
  const [bet, setBet] = useState(t.bet_id ?? "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateTaskAction(t.id, { title, description, priority, ...(campaigns ? { campaign_id: campaign || null } : {}), ...(bets ? { bet_id: bet || null } : {}) });
          setResult(r);
          if (r.ok) onDone();
        });
      }}
    >
      <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} required />
      <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
      <div className="flex flex-wrap gap-2">
        <select className={`${inputCls} w-auto`} value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])}>
          {["high", "medium", "low"].map((p) => <option key={p}>{p}</option>)}
        </select>
        {campaigns && (
          <select className={`${inputCls} w-auto`} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">No campaign</option>
            {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
          </select>
        )}
        {bets && (
          <select className={`${inputCls} w-auto`} value={bet} onChange={(e) => setBet(e.target.value)}>
            <option value="">No bet</option>
            {bets.map((b) => <option key={b.bet_id} value={b.bet_id}>{b.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button className={btnCls} disabled={pending}>Save</button>
        <button type="button" className={btnGhost} onClick={onDone}>Cancel</button>
        <ResultLine result={result} />
      </div>
    </form>
  );
}
