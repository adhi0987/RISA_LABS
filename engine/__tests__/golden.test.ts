// Golden numbers: every figure quoted in the strategy deck must be reproduced by the engine
// from the original 2025 dataset. If any of these fail, the slides and the product disagree.
import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseWorkbook, type ParsedDataset } from "@/lib/ingest/parse";
import { computeSnapshot } from "@/engine/snapshot";
import { DEFAULT_SETTINGS } from "@/engine/metrics";

let ds: ParsedDataset;
beforeAll(() => {
  ds = parseWorkbook(fs.readFileSync(path.join(__dirname, "../../data/original/Attendee Dataset.xlsx")));
});
const snap = (d: string) => computeSnapshot(ds, d, DEFAULT_SETTINGS);
const byId = (s: ReturnType<typeof snap>, id: string) => s.campaigns.find((c) => c.campaign_id === id)!;

describe("ingest", () => {
  it("removes exact import copies by stable ID", () => {
    const h = Object.fromEntries(ds.health.tables.map((t) => [t.table, t]));
    expect(h["Registration History"].importCopiesRemoved).toBe(4);
    expect(h["Check-ins"].importCopiesRemoved).toBe(20);
    expect(h["Daily Marketing"].importCopiesRemoved).toBe(2);
    expect(ds.people.length).toBe(3685);
    expect(ds.campaigns.length).toBe(7);
  });
  it("reads IST timestamps correctly", () => {
    expect(new Date(ds.event.event_starts_at).toISOString()).toBe("2025-04-12T04:30:00.000Z"); // 10:00 IST
    expect(ds.targets.map((t) => t.target_version)).toEqual(["Attendee launch plan", "Attendee revised plan"]);
  });
});

describe("final snapshot (20 Apr 2025)", () => {
  it("reproduces the headline numbers", () => {
    const s = snap("2025-04-20");
    expect(s.phase).toBe("post_event");
    expect(s.totals.attended).toBe(2050);
    expect(s.totals.registered).toBe(2800);
    expect(s.totals.no_shows).toBe(875);
    expect(s.totals.confirmed_no_shows).toBe(575);
    expect(s.totals.walk_ins).toBe(125);
    expect(s.totals.spend).toBe(274000);
    expect(Math.round(s.portfolio.cost_per_attendee!)).toBe(134);
    expect(s.target?.unique_external_visitors_goal).toBe(2200);
  });
  it("reproduces per-channel funnel and unit economics", () => {
    const s = snap("2025-04-20");
    const expected: Record<string, [number, number, number, number, number]> = {
      C01: [600, 520, 390, 42000, 108],
      C02: [960, 680, 340, 93000, 274],
      C03: [490, 350, 175, 59000, 337],
      C04: [500, 450, 385, 31000, 81],
      C05: [410, 350, 275, 19000, 69],
      C06: [290, 250, 195, 14000, 72],
      C07: [250, 200, 165, 16000, 97],
    };
    for (const [id, [ident, reg, att, spend, cpa]] of Object.entries(expected)) {
      const c = byId(s, id);
      expect([c.identified, c.registered, c.attended, c.spend, Math.round(c.cost.per_attendee!)], id).toEqual([ident, reg, att, spend, cpa]);
    }
  });
  it("final verdicts: Paid Social and Creators stop, College Partnerships scale", () => {
    const s = snap("2025-04-20");
    expect(byId(s, "C02").verdict.call).toBe("stop");
    expect(byId(s, "C03").verdict.call).toBe("stop");
    expect(byId(s, "C04").verdict.call).toBe("scale");
    expect(s.bottleneck.worst_stage).toBe("registered → attended");
  });
});

describe("backtest snapshots (Slide 3)", () => {
  it("T-28 (15 Mar): Creators fix at ₹314 / confirmed, Paid Social maintain at ₹149", () => {
    const s = snap("2025-03-15");
    expect(s.phase).toBe("pre_event");
    expect(s.portfolio.cost_per_confirmed!).toBeCloseTo(148.2, 1);
    expect(byId(s, "C03").cost.per_confirmed!).toBeCloseTo(314.0, 1);
    expect(byId(s, "C03").verdict.call).toBe("fix");
    expect(byId(s, "C02").cost.per_confirmed!).toBeCloseTo(149.0, 1);
    expect(byId(s, "C02").verdict.call).toBe("maintain");
  });
  it("T-7 (5 Apr): Creators fix ₹220 (191%), Paid Social fix ₹155 (134%)", () => {
    const s = snap("2025-04-05");
    expect(Math.round(byId(s, "C03").cost.per_confirmed!)).toBe(220);
    expect(Math.round(byId(s, "C03").verdict.ratio_pct!)).toBe(191);
    expect(byId(s, "C03").verdict.call).toBe("fix");
    expect(Math.round(byId(s, "C02").cost.per_confirmed!)).toBe(155);
    expect(Math.round(byId(s, "C02").verdict.ratio_pct!)).toBe(134);
    expect(byId(s, "C02").verdict.call).toBe("fix");
  });
  it("switches to the revised target plan on 15 Mar 09:00 IST", () => {
    expect(snap("2025-03-14").target?.target_version).toBe("Attendee launch plan");
    expect(snap("2025-03-15").target?.target_version).toBe("Attendee revised plan");
  });
});

describe("no leakage", () => {
  it("a pre-event snapshot sees no attendance and no future registrations", () => {
    const s = snap("2025-03-15");
    expect(s.totals.attended).toBe(0);
    expect(s.totals.no_shows).toBe(0);
    expect(s.totals.registered).toBeLessThan(2800);
    expect(s.totals.spend).toBe(189575);
  });
  it("spend at T-0 is higher than final (later vendor credits only appear later)", () => {
    expect(snap("2025-04-11").totals.spend).toBe(276500);
  });
});

describe("changed data flows through", () => {
  it("editing spend and a status changes metrics and the verdict", () => {
    const edited: ParsedDataset = { ...ds, daily: ds.daily.map((d) => ({ ...d })), history: [...ds.history] };
    // Halve Creators' spend → its cost ratio falls below the fix line at T-7.
    for (const d of edited.daily) if (d.campaign_id === "C03") d.marketing_spend_inr = d.marketing_spend_inr / 2;
    const s = computeSnapshot(edited, "2025-04-05", DEFAULT_SETTINGS);
    expect(byId(s, "C03").spend).toBe(27450);
    expect(byId(s, "C03").verdict.call).not.toBe("fix");
    // Append a cancellation for a registration that is confirmed on 5 Apr → confirmed −1, cancelled +1.
    const at = Date.parse("2025-04-05T12:00:00+05:30");
    const latestBefore = new Map<string, { at: number; status: string }>();
    for (const h of ds.history) if (h.effective_at <= at) {
      const cur = latestBefore.get(h.registration_id);
      if (!cur || h.effective_at > cur.at) latestBefore.set(h.registration_id, { at: h.effective_at, status: h.status });
    }
    const reg = ds.registrations.find((r) => r.campaign_id === "C04" && latestBefore.get(r.registration_id)?.status === "confirmed")!;
    const before = computeSnapshot(ds, "2025-04-05", DEFAULT_SETTINGS).totals;
    edited.history.push({ history_id: "TEST1", registration_id: reg.registration_id, person_id: reg.person_id, campaign_id: reg.campaign_id, owner_id: null, effective_at: at, status: "cancelled" });
    const after = computeSnapshot(edited, "2025-04-05", DEFAULT_SETTINGS).totals;
    expect(after.confirmed).toBe(before.confirmed - 1);
    expect(after.status_counts.cancelled).toBe(before.status_counts.cancelled + 1);
    // …and the cancellation is invisible to an earlier snapshot.
    expect(computeSnapshot(edited, "2025-04-04", DEFAULT_SETTINGS).totals.confirmed).toBe(computeSnapshot(ds, "2025-04-04", DEFAULT_SETTINGS).totals.confirmed);
  });
});
