import "server-only";
// Model chain for the AI analyst, served through OpenRouter.
// - Primary: OPENROUTER_MODEL (default inclusionai/ling-3.2-flash:free).
// - Fallbacks: OPENROUTER_FALLBACK_MODELS (comma-separated, tool-capable free models).
// - Optional last resort: Gemini, only when AI_GEMINI_FALLBACK=true and GEMINI_API_KEY is set
//   (or when no OpenRouter key is configured at all).
// Each call goes to the first available model. On a retryable failure (429 / 5xx / 404 / overload)
// or no content within FIRST_CHUNK_MS, the SAME call is replayed on the next model, and the failed
// model is put on a short cooldown so later steps skip it.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV4 } from "@ai-sdk/provider";

const FIRST_CHUNK_MS = 15_000;
const COOLDOWN_MS = 90_000; // generic failures
const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000; // upstream 429s: free quota is scarce, so stop re-trying for a while
const DEFAULT_OPENROUTER_MODEL = "inclusionai/ling-3.2-flash:free";
const DEFAULT_OPENROUTER_FALLBACKS = "nvidia/nemotron-3.5-lightning:free,google/gemma-4-31b-it:free";

type Candidate = { id: string; model: LanguageModelV4 };
const g = globalThis as unknown as { __modelDownUntil?: Map<string, number> };
const downUntil = (g.__modelDownUntil ??= new Map());

function buildCandidates(): Candidate[] {
  const list: Candidate[] = [];
  const orKey = process.env.OPENROUTER_API_KEY;
  if (orKey) {
    const openrouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: orKey,
      includeUsage: true,
      headers: { "X-Title": "CampusFest Growth Center" },
    });
    const ids = [process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL, ...(process.env.OPENROUTER_FALLBACK_MODELS ?? DEFAULT_OPENROUTER_FALLBACKS).split(",")]
      .map((s) => s.trim())
      .filter((s, i, a) => s && a.indexOf(s) === i);
    for (const id of ids) list.push({ id, model: openrouter(id) as unknown as LanguageModelV4 });
  }
  const geKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (geKey && (!orKey || process.env.AI_GEMINI_FALLBACK === "true")) {
    const google = createGoogleGenerativeAI({ apiKey: geKey });
    for (const id of [process.env.GEMINI_MODEL_PRIMARY, process.env.GEMINI_MODEL_FALLBACK].filter(Boolean) as string[]) {
      list.push({ id, model: google(id) as unknown as LanguageModelV4 });
    }
  }
  if (list.length === 0) throw new Error("No AI model configured: set OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL).");
  return list;
}

export const PRIMARY_MODEL = process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL : process.env.GEMINI_MODEL_PRIMARY || "gemini";

function isRetryable(e: unknown): boolean {
  const err = e as { statusCode?: number; status?: number; message?: string; lastError?: unknown; name?: string; responseBody?: string };
  if (err?.name === "AbortError" || err?.name === "TimeoutError" || /first-chunk timeout/i.test(err?.message ?? "")) return true;
  const status = err?.statusCode ?? err?.status;
  if (status === 429 || status === 404 || status === 402 || status === 408 || (typeof status === "number" && status >= 500)) return true;
  if (err?.lastError) return isRetryable(err.lastError);
  return /quota|rate.?limit|resource_exhausted|overloaded|unavailable|high demand|try again|timed? ?out|provider returned error|no endpoints/i.test(`${err?.message ?? ""} ${err?.responseBody ?? ""}`);
}

type StreamOpts = Parameters<LanguageModelV4["doStream"]>[0];
type StreamResult = Awaited<ReturnType<LanguageModelV4["doStream"]>>;
type Chunk = StreamResult["stream"] extends ReadableStream<infer C> ? C : never;
const CONTENT_TYPES = new Set(["text-delta", "reasoning-delta", "tool-input-start", "tool-input-delta", "tool-call", "finish"]);

function linkedController(outer?: AbortSignal) {
  const ctrl = new AbortController();
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener("abort", () => ctrl.abort(outer.reason), { once: true });
  }
  return ctrl;
}

/** Start a stream and wait (bounded) for its first content-bearing chunk, then hand back a replaying stream. */
async function streamWithFirstChunkTimeout(model: LanguageModelV4, options: StreamOpts, ms: number): Promise<StreamResult> {
  const ctrl = linkedController(options.abortSignal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`first-chunk timeout after ${ms}ms`);
      ctrl.abort(e);
      reject(e);
    }, ms);
  });
  try {
    const res = await Promise.race([model.doStream({ ...options, abortSignal: ctrl.signal }), timeout]);
    const reader = res.stream.getReader();
    const buffered: Chunk[] = [];
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      buffered.push(value);
      const type = (value as { type: string }).type;
      if (type === "error") throw (value as { error: unknown }).error;
      if (CONTENT_TYPES.has(type)) break;
    }
    clearTimeout(timer);
    const stream = new ReadableStream<Chunk>({
      start(c) {
        for (const b of buffered) c.enqueue(b);
      },
      async pull(c) {
        const { done, value } = await reader.read();
        if (done) c.close();
        else c.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return { ...res, stream };
  } catch (e) {
    clearTimeout(timer);
    if (!ctrl.signal.aborted) ctrl.abort(e);
    throw e;
  }
}

/** Order candidates: available ones first (in configured order), then cooling-down ones as a last resort. */
function ordered(cands: Candidate[]) {
  const now = Date.now();
  const up = cands.filter((c) => (downUntil.get(c.id) ?? 0) <= now);
  const down = cands.filter((c) => (downUntil.get(c.id) ?? 0) > now);
  return [...up, ...down];
}

export function modelChain(onUse?: (modelId: string) => void): LanguageModelV4 {
  const cands = buildCandidates();
  const first = cands[0].model;
  const attempt = async <T>(fn: (m: LanguageModelV4) => PromiseLike<T>, abortSignal?: AbortSignal): Promise<T> => {
    let lastError: unknown;
    for (const c of ordered(cands)) {
      try {
        const r = await fn(c.model);
        onUse?.(c.id);
        return r;
      } catch (e) {
        lastError = e;
        if (!isRetryable(e) || abortSignal?.aborted) throw e;
        const status = (e as { statusCode?: number })?.statusCode;
        downUntil.set(c.id, Date.now() + (status === 429 ? RATE_LIMIT_COOLDOWN_MS : COOLDOWN_MS));
        console.warn(`[ai] ${c.id} failed (${e instanceof Error ? e.message.slice(0, 100) : String(e)}); trying next model`);
      }
    }
    throw lastError;
  };
  return {
    specificationVersion: first.specificationVersion,
    provider: first.provider,
    modelId: cands[0].id,
    supportedUrls: first.supportedUrls,
    doGenerate: (options) => attempt((m) => m.doGenerate(options), options.abortSignal),
    doStream: (options) => attempt((m) => streamWithFirstChunkTimeout(m, options, FIRST_CHUNK_MS), options.abortSignal),
  };
}
