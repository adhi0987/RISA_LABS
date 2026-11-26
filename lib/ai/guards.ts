import "server-only";
// Safety rails for the AI tools: read-only SQL, safe math, rate limits and daily quota.
import crypto from "node:crypto";
import { create, all } from "mathjs";
import { getSql } from "@/lib/db/client";

// ───────────── read-only SQL ─────────────
const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|set|reset|lock|vacuum|analyze|refresh|listen|notify|unlisten|prepare|deallocate|begin|commit|rollback|savepoint|discard|load|security|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|current_setting|set_config|into)\b/i;

export function validateSql(input: string): { ok: true; sql: string } | { ok: false; error: string } {
  let q = input.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  q = q.replace(/;\s*$/, "");
  if (!q) return { ok: false, error: "Empty query." };
  if (q.includes(";")) return { ok: false, error: "Only a single statement is allowed." };
  if (!/^(select|with)\b/i.test(q)) return { ok: false, error: "Only SELECT queries (optionally starting with WITH) are allowed." };
  const m = q.match(FORBIDDEN);
  if (m) return { ok: false, error: `Keyword "${m[0]}" is not allowed in read-only analysis queries.` };
  if (/\b(app|public|pg_catalog|information_schema|auth|storage)\s*\./i.test(q)) return { ok: false, error: "Query only the analytics views (v_*); other schemas are not accessible." };
  if (q.length > 4000) return { ok: false, error: "Query too long." };
  return { ok: true, sql: q };
}

const fmtCell = (v: unknown): unknown => {
  if (v instanceof Date) return new Date(v.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ") + " IST";
  if (typeof v === "bigint") return Number(v);
  return v;
};

export async function runReadOnlySql(input: string, maxRows = 200) {
  const v = validateSql(input);
  if (!v.ok) return { ok: false as const, error: v.error };
  const sql = getSql();
  try {
    const rows = await sql.begin("read only", async (tx) => {
      await tx`set local role analyst_ro`;
      await tx`set local statement_timeout = '4s'`;
      await tx`set local search_path = analytics`;
      return tx.unsafe(`select * from (${v.sql}) as _q limit ${maxRows + 1}`);
    });
    const list = (rows as unknown as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, fmtCell(x)])));
    return { ok: true as const, row_count: Math.min(list.length, maxRows), truncated: list.length > maxRows, rows: list.slice(0, maxRows) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

// ───────────── safe math ─────────────
const math = create(all, {});
const evaluateExpr = math.evaluate.bind(math);
const blocked = () => {
  throw new Error("Function disabled");
};
math.import({ import: blocked, createUnit: blocked, evaluate: blocked, parse: blocked, simplify: blocked, derivative: blocked, compile: blocked, resolve: blocked, reviver: blocked }, { override: true });

export function safeCalculate(expression: string): { ok: true; result: number | string } | { ok: false; error: string } {
  if (expression.length > 500) return { ok: false, error: "Expression too long." };
  try {
    const r = evaluateExpr(expression.replace(/₹|,(?=\d{2,3}\b)/g, ""));
    const n = typeof r === "number" ? r : Number(r?.toString?.());
    if (Number.isFinite(n)) return { ok: true, result: Math.round(n * 1e6) / 1e6 };
    return { ok: true, result: String(r) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ───────────── rate limits & quota ─────────────
export const PER_VISITOR_LIMIT = 15; // messages
export const PER_VISITOR_WINDOW_S = 600; // per 10 minutes

export async function checkRateLimit(ip: string): Promise<{ ok: true } | { ok: false; retryAfterS: number }> {
  const sql = getSql();
  const key = `ip:${crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
  const [row] = await sql<{ count: number; window_start: Date }[]>`
    insert into app.rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when app.rate_limits.window_start < now() - make_interval(secs => ${PER_VISITOR_WINDOW_S}) then 1 else app.rate_limits.count + 1 end,
      window_start = case when app.rate_limits.window_start < now() - make_interval(secs => ${PER_VISITOR_WINDOW_S}) then now() else app.rate_limits.window_start end
    returning count, window_start`;
  if (row.count > PER_VISITOR_LIMIT) {
    const retry = Math.max(1, Math.round(PER_VISITOR_WINDOW_S - (Date.now() - new Date(row.window_start).getTime()) / 1000));
    return { ok: false, retryAfterS: retry };
  }
  return { ok: true };
}

export async function dailyCallsUsed(): Promise<number> {
  const sql = getSql();
  const [row] = await sql<{ calls: number }[]>`select calls from app.llm_usage where day = (now() at time zone 'Asia/Kolkata')::date`;
  return row?.calls ?? 0;
}

export async function recordUsage(calls: number, inputTokens: number, outputTokens: number) {
  const sql = getSql();
  await sql`insert into app.llm_usage (day, calls, input_tokens, output_tokens)
            values ((now() at time zone 'Asia/Kolkata')::date, ${calls}, ${inputTokens}, ${outputTokens})
            on conflict (day) do update set calls = app.llm_usage.calls + excluded.calls,
              input_tokens = app.llm_usage.input_tokens + excluded.input_tokens, output_tokens = app.llm_usage.output_tokens + excluded.output_tokens`;
}
