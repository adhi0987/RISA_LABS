import "server-only";
// Gemini models with automatic fallback.
// - Errors (429 / 5xx / 404 / quota / overload) on the primary → same call retried on the fallback model.
// - Hangs: if the primary produces no content within FIRST_CHUNK_MS, the call is aborted and replayed on the fallback.
// - Circuit breaker: after a primary failure, skip it for BREAKER_MS so later steps don't pay the timeout again.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV4 } from "@ai-sdk/provider";

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY });

export const PRIMARY_MODEL = process.env.GEMINI_MODEL_PRIMARY || "gemini-3.6-flash";
export const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-3.5-flash-lite";

const FIRST_CHUNK_MS = 12_000;
const BREAKER_MS = 3 * 60_000;
const g = globalThis as unknown as { __primaryDownUntil?: number };

function isRetryable(e: unknown): boolean {
  const err = e as { statusCode?: number; status?: number; message?: string; lastError?: unknown; name?: string };
  if (err?.name === "AbortError" || err?.name === "TimeoutError" || /first-chunk timeout/i.test(err?.message ?? "")) return true;
  const status = err?.statusCode ?? err?.status;
  if (status === 429 || status === 404 || (typeof status === "number" && status >= 500)) return true;
  if (err?.lastError) return isRetryable(err.lastError);
  return /quota|rate limit|resource_exhausted|overloaded|unavailable|high demand|try again|timed? ?out/i.test(err?.message ?? "");
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

/** Start a stream and wait for its first content-bearing chunk (bounded), then hand back a replaying stream. */
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

export function withFallback(primary: LanguageModelV4, fallback: LanguageModelV4, onFallback?: (e: unknown) => void): LanguageModelV4 {
  const primaryAvailable = () => !g.__primaryDownUntil || Date.now() > g.__primaryDownUntil;
  const tripBreaker = (e: unknown) => {
    g.__primaryDownUntil = Date.now() + BREAKER_MS;
    onFallback?.(e);
  };
  return {
    specificationVersion: primary.specificationVersion,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    async doGenerate(options) {
      if (!primaryAvailable()) {
        onFallback?.(new Error("primary circuit open"));
        return fallback.doGenerate(options);
      }
      try {
        return await primary.doGenerate(options);
      } catch (e) {
        if (!isRetryable(e) || options.abortSignal?.aborted) throw e;
        tripBreaker(e);
        return fallback.doGenerate(options);
      }
    },
    async doStream(options) {
      if (!primaryAvailable()) {
        onFallback?.(new Error("primary circuit open"));
        try {
          return await streamWithFirstChunkTimeout(fallback, options, FIRST_CHUNK_MS * 2);
        } catch (e) {
          // Fallback rate-limited or overloaded too: give the primary another chance before failing.
          if (!isRetryable(e) || options.abortSignal?.aborted) throw e;
          console.warn(`[ai] fallback ${FALLBACK_MODEL} failed (${e instanceof Error ? e.message.slice(0, 80) : e}); retrying primary`);
          return streamWithFirstChunkTimeout(primary, options, FIRST_CHUNK_MS * 2);
        }
      }
      try {
        return await streamWithFirstChunkTimeout(primary, options, FIRST_CHUNK_MS);
      } catch (e) {
        if (!isRetryable(e) || options.abortSignal?.aborted) throw e;
        console.warn(`[ai] primary ${PRIMARY_MODEL} failed (${e instanceof Error ? e.message.slice(0, 120) : e}); using ${FALLBACK_MODEL}`);
        tripBreaker(e);
        return streamWithFirstChunkTimeout(fallback, options, FIRST_CHUNK_MS * 2);
      }
    },
  };
}

export function analystModel(onFallback?: (e: unknown) => void) {
  return withFallback(google(PRIMARY_MODEL) as unknown as LanguageModelV4, google(FALLBACK_MODEL) as unknown as LanguageModelV4, onFallback);
}
