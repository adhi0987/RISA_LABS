// The 2026 Planner must reproduce Slide 1's base and stretch from live 2025 benchmarks.
import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseWorkbook, type ParsedDataset } from "@/lib/ingest/parse";
import { computeSnapshot } from "@/engine/snapshot";
import { DEFAULT_SETTINGS } from "@/engine/metrics";
import { benchmarksFrom, runPlan, scoreBets } from "@/engine/planner";
import { computeBreakdown } from "@/engine/series";
import { BETS } from "@/lib/seed-data";

let ds: ParsedDataset;
beforeAll(() => {
  ds = parseWorkbook(fs.readFileSync(path.join(__dirname, "../../data/original/Attendee Dataset.xlsx")));
});

describe("2026 planner", () => {
  it("base ≈ 3,145 attendees on ≈ ₹3.93L; stretch ≈ 5,575 on ≈ ₹6.75L", () => {
    const bench = benchmarksFrom(computeSnapshot(ds, "2025-04-20", DEFAULT_SETTINGS));
    const base = runPlan("base", bench);
    const stretch = runPlan("stretch", bench);
    const seg = (r: typeof base, id: string) => Math.round(r.segments.find((s) => s.id === id)!.attendees);
    expect(seg(base, "colleges")).toBe(924);
    expect(seg(stretch, "colleges")).toBe(2008);
    expect(seg(base, "paid")).toBe(350);
    expect(seg(stretch, "referrals")).toBeGreaterThanOrEqual(1074);
    expect(Math.abs(base.totals.attendees - 3145)).toBeLessThanOrEqual(3);
    expect(Math.abs(stretch.totals.attendees - 5575)).toBeLessThanOrEqual(3);
    expect(Math.round(base.totals.spend / 1000)).toBe(393);
    expect(Math.round(stretch.totals.spend / 1000)).toBe(675);
    expect(Math.round(base.capacity.ceiling)).toBe(8865);
  });
  it("two-day visitor share in the data is ~35%", () => {
    const b = computeBreakdown(ds, "2025-04-20", "attendance_by_day") as { values: { two_day_share: number } };
    expect(b.values.two_day_share).toBeGreaterThan(0.33);
    expect(b.values.two_day_share).toBeLessThan(0.38);
  });
  it("bet scores follow attendees × confidence ÷ ₹ lakh", () => {
    const rows = scoreBets(BETS.map((b) => ({ ...b })));
    expect(Math.round(rows[0].score!)).toBe(605); // College Pods (slide shows 606 from unrounded inputs)
    expect(rows[3].score).toBeNull(); // budget cut, not scored
  });
});
