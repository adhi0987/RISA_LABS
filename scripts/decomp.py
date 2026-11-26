#!/usr/bin/env python3
"""Independent reproduction of the strategy deck's numbers (Slides 1-2), standard library only.

Reads the ORIGINAL attendee workbook directly (no app, no database), applies the dataset rules,
derives 2025 channel benchmarks, then builds the 2026 base/stretch plan and the sequential
decomposition into the five bets. It is a cross-check of the TypeScript engine (engine/planner.ts).

Usage:  python scripts/decomp.py ["data/original/Attendee Dataset.xlsx"]
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def col_index(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_sheets(path, wanted):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for s in wb.find("m:sheets", NS):
        name = s.get("name")
        if name not in wanted:
            continue
        target = rels[s.get("{%s}id" % NS["r"])].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).find("m:sheetData", NS).findall("m:row", NS):
            vals = {}
            for c in row.findall("m:c", NS):
                v = c.find("m:v", NS)
                if v is None:
                    continue
                vals[col_index(c.get("r"))] = shared[int(v.text)] if c.get("t") == "s" else v.text
            if vals:
                rows.append(vals)
        header = rows[0]
        keys = [header[i] for i in sorted(header)]
        out[name] = [{k: r.get(i) for i, k in zip(sorted(header), keys)} for r in rows[1:]]
    return out


def dedupe(rows, key):
    seen = {}
    for r in rows:
        seen[r[key]] = r
    return list(seen.values())


def benchmarks(path):
    s = read_sheets(path, {"People", "Registrations", "Check-ins", "Daily Marketing"})
    people = dedupe(s["People"], "person_id")
    external = {p["person_id"] for p in people if p["person_type"] == "external"}
    regs = [r for r in dedupe(s["Registrations"], "registration_id") if r["person_id"] in external]
    checkins = dedupe(s["Check-ins"], "event_id")
    visitors = {c["person_id"] for c in checkins
                if c["result"] == "admitted" and c["verification"] == "verified" and c["person_id"] in external}
    spend = defaultdict(float)
    for d in dedupe(s["Daily Marketing"], "activity_id"):
        spend[d["campaign_id"]] += float(d["marketing_spend_inr"] or 0)
    identified = defaultdict(int)
    for p in people:
        if p["person_id"] in external and p.get("first_campaign_id"):
            identified[p["first_campaign_id"]] += 1
    registered, attended = defaultdict(int), defaultdict(int)
    for r in regs:
        registered[r["campaign_id"]] += 1
        if r["person_id"] in visitors:
            attended[r["campaign_id"]] += 1
    walk_ins = len(visitors - {r["person_id"] for r in regs})
    bench = {cid: {"reg_rate": registered[cid] / identified[cid],
                   "show_rate": attended[cid] / registered[cid],
                   "cpi": spend[cid] / identified[cid]} for cid in identified}
    summary = {"visitors": len(visitors), "registrants": len(regs), "spend": sum(spend.values()), "walk_ins": walk_ins}
    return bench, summary


# Segment definitions (deck assumptions): driver params for base / stretch and the Show-Up uplift.
SEGMENTS = [
    ("colleges", "C04", "count", {"base": (40, 1200, 0.025), "stretch": (70, 1200, 0.03)}, 3, 0),
    ("referrals", "C05", "k", {"base": 0.17167, "stretch": 0.30}, 5, 40),
    ("ambassadors", "C01", "count", {"base": (100, 250, 0.03), "stretch": (160, 250, 0.03)}, 6, 0),
    ("clubs", "C07", "count", {"base": (25, 600, 0.03), "stretch": (40, 600, 0.03)}, 4, 0),
    ("search", "C06", "fixed", {"base": 580, "stretch": 580}, 5, 0),
    ("paid", "C02", "spend", {"base": 110000, "stretch": 80000}, 12, 0),
    ("creators", "C03", "spend", {"base": 40000, "stretch": 25000}, 12, 0),
]
INFLATION, WALK_IN_SHARE = 1.15, 0.065


def run(bench, state, programme):
    """state: seg_id -> (scenario_for_params, uplift_on, extra_cost_on)"""
    results = {}
    def seg_result(seg, other_registered=0.0):
        sid, cid, driver, params, uplift, extra = seg
        scen, up, ex = state[sid]
        b = bench[cid]
        cpi = b["cpi"] * INFLATION
        p = params[scen]
        if driver == "count":
            identified = p[0] * p[1] * p[2]
        elif driver == "k":
            identified = p * other_registered
        elif driver == "fixed":
            identified = p
        else:
            identified = p / cpi
        registered = identified * b["reg_rate"]
        attendees = registered * min(1.0, b["show_rate"] + (uplift / 100 if up else 0))
        spend = (p if driver == "spend" else identified * cpi) + (attendees * extra if ex else 0)
        return {"identified": identified, "registered": registered, "attendees": attendees, "spend": spend}
    for seg in SEGMENTS:
        if seg[2] != "k":
            results[seg[0]] = seg_result(seg)
    other = sum(r["registered"] for r in results.values())
    for seg in SEGMENTS:
        if seg[2] == "k":
            results[seg[0]] = seg_result(seg, other)
    campaign_att = sum(r["attendees"] for r in results.values())
    return campaign_att * (1 + WALK_IN_SHARE), sum(r["spend"] for r in results.values()) + programme


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "data/original/Attendee Dataset.xlsx"
    bench, summary = benchmarks(path)
    print(f"2025 actuals: {summary['visitors']:,} verified visitors, {summary['registrants']:,} registrants, "
          f"Rs {summary['spend']:,.0f} spend, {summary['walk_ins']} walk-ins")
    print("Channel benchmarks (reg rate / show rate / Rs per identified):")
    for cid in sorted(bench):
        b = bench[cid]
        print(f"  {cid}: {b['reg_rate']:.1%} / {b['show_rate']:.1%} / Rs {b['cpi']:.1f}")

    state = {s[0]: ("base", False, False) for s in SEGMENTS}
    base_att, base_spend = run(bench, state, 0)
    print(f"\nBase: {base_att:,.0f} attendees, Rs {base_spend:,.0f}")

    confidence = {"B1": 0.70, "B2": 0.60, "B3": 0.55, "B4": 0.40, "B5": 0.30}
    steps = [
        ("B1", "College Pods", ["colleges", "clubs"], False, 40000),
        ("B3", "Ambassador + referral flywheel", ["ambassadors", "referrals"], False, 0),
        ("B2", "Show-Up Engineering", [], True, 45000),
        ("B4", "Paid social -> retargeting", ["paid"], False, 0),
        ("B5", "Creators pay-per-attendee", ["creators"], False, 0),
    ]
    programme, prev_att, prev_spend, rows = 0, base_att, base_spend, []
    for bet, label, segs, showup, cost in steps:
        for sid in segs:
            scen, up, ex = state[sid]
            state[sid] = ("stretch", up, sid == "referrals" or ex)
        if showup:
            state = {k: (v[0], True, v[2]) for k, v in state.items()}
        programme += cost
        att, spend = run(bench, state, programme)
        rows.append((bet, label, att - prev_att, spend - prev_spend))
        prev_att, prev_spend = att, spend
    print(f"Stretch: {prev_att:,.0f} attendees, Rs {prev_spend:,.0f}\n")
    best = max(d / (s / 1e5) for _, _, d, s in rows if s > 0)
    print(f"{'Bet':<34}{'d attendees':>12}{'marginal Rs':>13}{'per Rs1L':>10}{'score/net':>12}")
    for bet, label, d, s in rows:
        per_lakh = abs(d) / (abs(s) / 1e5)
        score = f"{d * confidence[bet] / (s / 1e5):.0f}" if s > 0 else f"+{(-s / 1e5) * best + d:.0f} net"
        print(f"{bet} {label:<31}{d:>+12.0f}{s:>13,.0f}{per_lakh:>10.0f}{score:>12}")


if __name__ == "__main__":
    main()
