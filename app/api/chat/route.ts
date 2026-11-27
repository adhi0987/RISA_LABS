import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from "ai";
import { getDataset, clampAsOf } from "@/lib/data/dataset";
import { listProposals } from "@/lib/data/management";
import { computeSnapshot } from "@/engine/snapshot";
import { buildTools } from "@/lib/ai/tools";
import { buildInstructions } from "@/lib/ai/prompt";
import { modelChain, PRIMARY_MODEL } from "@/lib/ai/model";
import { checkRateLimit, dailyCallsUsed, recordUsage } from "@/lib/ai/guards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAILY_CAP = Number(process.env.AI_DAILY_CALL_CAP ?? 600);
const MAX_STEPS = 6;
const KEEP_TOOL_DETAIL_FOR_LAST = 4; // messages; older turns keep only their text (saves tokens)

type Part = { type: string; state?: string; output?: unknown; text?: string };

function trimHistory(messages: UIMessage[]): UIMessage[] {
  const recent = messages.slice(-20);
  return recent.map((m, i) => {
    if (i >= recent.length - KEEP_TOOL_DETAIL_FOR_LAST || m.role !== "assistant") return m;
    const parts = (m.parts as Part[]).filter((p) => p.type === "text");
    return { ...m, parts: (parts.length ? parts : [{ type: "text", text: "(analysis shown earlier)" }]) as UIMessage["parts"] };
  });
}

function proposalIds(messages: UIMessage[]): number[] {
  const ids: number[] = [];
  for (const m of messages) {
    for (const p of m.parts as Part[]) {
      if (p.type === "tool-propose_actions" && p.state === "output-available") {
        const out = p.output as { proposals?: { id: number }[] } | undefined;
        for (const x of out?.proposals ?? []) ids.push(x.id);
      }
    }
  }
  return ids;
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/quota|rate|429|resource_exhausted/i.test(msg)) return "All free AI models are busy or rate-limited right now. Please try again in a minute. The dashboard, verdicts and projections keep working without the analyst.";
  if (/overloaded|unavailable|503|high demand/i.test(msg)) return "The AI model is temporarily overloaded. Please retry in a few seconds.";
  return `The analyst hit an error: ${msg.slice(0, 200)}`;
}

export async function POST(req: Request) {
  let body: { messages?: UIMessage[]; asOf?: string; page?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return Response.json({ error: "No messages." }, { status: 400 });
  const lastText = (messages[messages.length - 1]?.parts as Part[] | undefined)?.filter((p) => p.type === "text").map((p) => p.text ?? "").join(" ") ?? "";
  if (lastText.length > 4000) return Response.json({ error: "Message too long (max 4,000 characters)." }, { status: 400 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const evalBypass = !!process.env.EVAL_TOKEN && req.headers.get("x-eval-token") === process.env.EVAL_TOKEN;
  const rl = evalBypass ? ({ ok: true } as const) : await checkRateLimit(ip);
  if (!rl.ok) return Response.json({ error: `You've hit the chat limit (15 messages per 10 minutes). Try again in ${Math.ceil(rl.retryAfterS / 60)} min.` }, { status: 429 });
  if ((await dailyCallsUsed()) >= DAILY_CAP) return Response.json({ error: "Today's AI quota for this demo is used up. The dashboard and all analytics still work; the analyst resets at midnight IST." }, { status: 429 });

  const cache = await getDataset();
  const asOf = clampAsOf(body.asOf ?? null, cache.dataset);
  const s = computeSnapshot(cache.dataset, asOf, cache.settings);
  const proposals = await listProposals(proposalIds(messages));
  const owners = cache.dataset.owners.map((o) => `${o.owner_id} ${o.owner_name}`).join(", ");

  const isWhatIf = /\bwhat if\b|\bwhat would happen\b|\bwhat happens if\b|\bscenario\b|\bimpact of (moving|shifting|cutting|adding|increasing|reducing)\b|\bif we (move|moved|shift|cut|add|increase|reduce|double|halve|reallocate|stop|pause)\b/i.test(lastText);
  let usedModel = PRIMARY_MODEL;
  const result = streamText({
    model: modelChain((id) => {
      usedModel = id;
    }),
    instructions: buildInstructions({
      asOf,
      phase: s.phase,
      daysToEvent: s.days_to_event,
      page: typeof body.page === "string" ? body.page.slice(0, 200) : "/",
      owners,
      proposalStatuses: proposals.map((p) => `#${p.id} ${p.status}: ${p.summary}`),
    }),
    messages: await convertToModelMessages(trimHistory(messages)),
    tools: buildTools({ asOf }),
    stopWhen: isStepCount(MAX_STEPS),
    // Grounding guards (important with smaller free models):
    // 1) the first step must call a tool, so no answer is produced without fetching data;
    // 2) what-if questions must go through run_scenario (forced within the first steps if the model skipped it).
    prepareStep: ({ stepNumber, steps }: { stepNumber: number; steps: { toolCalls: { toolName: string }[] }[] }) => {
      const used = new Set(steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)));
      if (isWhatIf && !used.has("run_scenario") && stepNumber >= 1 && stepNumber <= 3) return { toolChoice: { type: "tool" as const, toolName: "run_scenario" as const } };
      if (stepNumber === 0) return { toolChoice: "required" as const };
      return {};
    },
    maxRetries: 1,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    onFinish: async (event: unknown) => {
      const e = event as { steps?: unknown[]; totalUsage?: { inputTokens?: number; outputTokens?: number } };
      await recordUsage(e.steps?.length ?? 1, e.totalUsage?.inputTokens ?? 0, e.totalUsage?.outputTokens ?? 0).catch(() => {});
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      onError: friendlyError,
      messageMetadata: ({ part }: { part: { type: string } }) =>
        part.type === "finish" ? { asOf, model: usedModel } : part.type === "start" ? { asOf } : undefined,
    }),
  });
}
