"use client";
// AI Growth Analyst side panel. Sends the selected as-of date and current page with every message,
// renders tool calls as inspectable "sources", and shows Confirm / Reject cards for proposed actions.
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import { Bot, Check, ChevronDown, Database, Loader2, RotateCcw, Send, Sparkles, Square, X } from "lucide-react";
import { confirmProposalAction, proposalStatusesAction, rejectProposalAction } from "@/app/actions";

const STORAGE_KEY = "gc-analyst-chat-v1";

const STARTERS = [
  "Run my Monday review: what changed in the last 7 days, current verdicts, overdue tasks, and the actions you'd propose.",
  "What should we scale, fix or stop this week?",
  "Where is the biggest leak in the funnel, and which campaigns cause it?",
  "Are we on track for the visitor goal? What's the gap?",
  "What changed in the last 7 days, and what's driving it?",
  "What if we move half of Creator Partners' remaining budget to College Partnerships?",
  "Which college sent the most attendees?",
];

const TOOL_LABEL: Record<string, string> = {
  get_overview: "Overview snapshot",
  get_campaigns: "Campaign metrics",
  get_trend: "Trend",
  compare_snapshots: "Snapshot comparison",
  get_breakdown: "Breakdown",
  run_scenario: "Scenario model",
  get_tasks: "Tasks",
  get_plan_2026: "2026 plan",
  query_data: "SQL query",
  calculate: "Calculation",
  propose_actions: "Proposed actions",
};

type AnyPart = { type: string; text?: string; state?: string; input?: unknown; output?: unknown; errorText?: string; toolCallId?: string };

export function AiPanel() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const asOf = sp.get("asOf");
  const page = `${pathname}${sp.get("c") ? ` (campaign ${sp.get("c")} selected)` : ""}`;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error, stop, setMessages, clearError } = useChat({ id: "growth-analyst", transport });

  // restore + persist conversation (follow-ups survive page navigation)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw) as UIMessage[]);
      setOpen(localStorage.getItem(`${STORAGE_KEY}-open`) === "1");
    } catch {}
    setLoaded(true);
  }, [setMessages]);
  useEffect(() => {
    if (loaded && status !== "streaming") localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  }, [messages, status, loaded]);
  useEffect(() => {
    if (loaded) localStorage.setItem(`${STORAGE_KEY}-open`, open ? "1" : "0");
  }, [open, loaded]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";
  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    clearError();
    sendMessage({ text: t }, { body: { asOf, page } });
    setInput("");
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700"
        >
          <Sparkles className="h-4 w-4" /> Ask the Growth Analyst
        </button>
      )}
      {open && (
        <aside className="fixed inset-0 z-40 flex flex-col border-l border-zinc-200 bg-white shadow-2xl md:sticky md:top-0 md:h-screen md:w-[440px] md:shrink-0 md:shadow-none">
          <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold"><Bot className="h-4 w-4 text-indigo-600" /> AI Growth Analyst</div>
              <div className="text-[11px] text-zinc-500">Answers from live app data · as of <span className="font-medium text-zinc-700">{asOf ?? "latest date"}</span></div>
            </div>
            <div className="flex items-center gap-1">
              <button title="New conversation" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100" onClick={() => { stop(); setMessages([]); localStorage.removeItem(STORAGE_KEY); }}><RotateCcw className="h-4 w-4" /></button>
              <button title="Close" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-600">I analyse the campaign data in this app (as of the date selected at the top), diagnose what&apos;s working, run what-ifs, and turn decisions into tasks you confirm. I&apos;ll say so when the data can&apos;t answer.</p>
                <div className="space-y-1.5">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50/50">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <MessageView key={m.id} message={m} />
            ))}
            {status === "submitted" && (
              <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing live data…</div>
            )}
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {parseError(error)}
              </div>
            )}
          </div>

          <form className="border-t border-zinc-200 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                rows={2}
                placeholder="Ask about performance, bottlenecks, what-ifs, or say what to do…"
                className="flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              {busy ? (
                <button type="button" onClick={() => stop()} className="rounded-lg border border-zinc-300 p-2.5 text-zinc-600 hover:bg-zinc-50" title="Stop"><Square className="h-4 w-4" /></button>
              ) : (
                <button className="rounded-lg bg-indigo-600 p-2.5 text-white hover:bg-indigo-700 disabled:opacity-40" disabled={!input.trim()} title="Send"><Send className="h-4 w-4" /></button>
              )}
            </div>
            <div className="mt-1.5 text-[10px] text-zinc-400">Gemini via tools over this app&apos;s data. Proposed changes apply only when you click Confirm.</div>
          </form>
        </aside>
      )}
    </>
  );
}

function parseError(e: Error): string {
  try {
    const j = JSON.parse(e.message);
    if (j?.error) return j.error;
  } catch {}
  return e.message || "Something went wrong.";
}

function MessageView({ message }: { message: UIMessage }) {
  const parts = message.parts as AnyPart[];
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white">{parts.filter((p) => p.type === "text").map((p) => p.text).join("")}</div>
      </div>
    );
  }
  const tools = parts.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool");
  const meta = message.metadata as { model?: string; asOf?: string } | undefined;
  return (
    <div className="space-y-2">
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tools.filter((p) => p.type !== "tool-propose_actions").map((p, i) => <ToolChip key={p.toolCallId ?? i} part={p} />)}
        </div>
      )}
      {parts.map((p, i) =>
        p.type === "text" && p.text ? (
          <div key={i} className="prose-chat text-sm leading-relaxed text-zinc-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown>
          </div>
        ) : null,
      )}
      {/* Proposal cards go after the text, which tells the user to confirm "below". */}
      {parts.filter((p) => p.type === "tool-propose_actions").map((p, i) => <ProposalCards key={p.toolCallId ?? i} part={p} />)}
      {meta?.model && <div className="text-[10px] text-zinc-400">{meta.model}{meta.asOf ? ` · data as of ${meta.asOf}` : ""}</div>}
    </div>
  );
}

function ToolChip({ part }: { part: AnyPart }) {
  const [open, setOpen] = useState(false);
  const name = part.type.replace(/^tool-/, "");
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error" || (part.output as { ok?: boolean } | undefined)?.ok === false;
  const input = part.input as Record<string, unknown> | undefined;
  const hint = input ? (input.as_of as string) ?? (input.metric as string) ?? (input.dimension as string) ?? (input.expression as string) ?? (input.purpose as string) ?? (Array.isArray(input.campaign_ids) ? (input.campaign_ids as string[]).join(",") : "") : "";
  return (
    <div className={clsx("rounded-md border text-[11px]", open ? "w-full" : "", failed ? "border-rose-200 bg-rose-50" : "border-zinc-200 bg-zinc-50")}>
      <button className="flex items-center gap-1 px-1.5 py-0.5 text-zinc-600" onClick={() => setOpen((v) => !v)}>
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
        <span className="font-medium">{TOOL_LABEL[name] ?? name}</span>
        {hint && <span className="max-w-[160px] truncate text-zinc-400">· {String(hint)}</span>}
        <ChevronDown className={clsx("h-3 w-3 transition", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-zinc-200 px-2 py-1 font-mono text-[10px] leading-snug text-zinc-700">
          {JSON.stringify({ input: part.input, output: part.output ?? part.errorText }, null, 1)}
        </pre>
      )}
    </div>
  );
}

function ProposalCards({ part }: { part: AnyPart }) {
  const out = part.output as { ok?: boolean; proposals?: { id: number; summary: string }[]; errors?: string[] } | undefined;
  const ids = useMemo(() => out?.proposals?.map((p) => p.id) ?? [], [out]);
  const [statuses, setStatuses] = useState<Record<number, { status: string; error?: string }>>({});
  const [pending, start] = useTransition();
  useEffect(() => {
    if (ids.length) proposalStatusesAction(ids).then(setStatuses).catch(() => {});
  }, [ids]);
  if (part.state !== "output-available") return <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing proposals…</div>;
  if (!out?.ok) return <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">Proposal rejected by validation: {out?.errors?.join("; ")}</div>;

  const act = (id: number, kind: "confirm" | "reject") =>
    start(async () => {
      const r = kind === "confirm" ? await confirmProposalAction(id) : await rejectProposalAction(id);
      setStatuses((s) => ({ ...s, [id]: r.ok ? { status: kind === "confirm" ? "applied" : "rejected" } : { status: "failed", error: r.error } }));
    });

  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">Proposed actions · nothing changes until you confirm</div>
      {out.proposals!.map((p) => {
        const st = statuses[p.id]?.status ?? "pending";
        return (
          <div key={p.id} className="rounded-md border border-violet-100 bg-white p-2">
            <div className="text-sm text-zinc-800">{p.summary}</div>
            <div className="mt-1.5 flex items-center gap-2">
              {st === "pending" ? (
                <>
                  <button disabled={pending} onClick={() => act(p.id, "confirm")} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="h-3 w-3" /> Confirm</button>
                  <button disabled={pending} onClick={() => act(p.id, "reject")} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">Reject</button>
                </>
              ) : (
                <span className={clsx("text-xs font-medium", st === "applied" ? "text-emerald-700" : st === "failed" ? "text-rose-700" : "text-zinc-500")}>
                  {st === "applied" ? "✓ Applied: see Tasks / Campaigns / Activity log" : st === "rejected" ? "Rejected" : `Failed: ${statuses[p.id]?.error ?? ""}`}
                </span>
              )}
              <span className="ml-auto text-[10px] text-zinc-400">#{p.id}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
