import { getSql } from "@/lib/db/client";

export const dynamic = "force-dynamic";

// Health + keep-alive endpoint (also used by the daily Vercel cron so the free Supabase project never pauses).
export async function GET() {
  const t = Date.now();
  try {
    const sql = getSql();
    const [r] = await sql`select (value)::text::int as version from app.meta where key = 'data_version'`;
    return Response.json({ ok: true, data_version: r?.version ?? null, db_ms: Date.now() - t });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), db_ms: Date.now() - t }, { status: 500 });
  }
}
