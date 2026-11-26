// Seed content for management tables: the five ranked bets from Slide 2 and starter tasks.
// These are plan assumptions from the strategy deck, not source data.

export const BETS = [
  {
    bet_id: "B1", rank: 1, name: "College Pods", call: "double_down",
    concept: "Clubs register as squads of 5+ (pod lead, group check-in) and compete in an inter-college league. Builds on the best 2025 channel: College Partnerships 90% register, 86% attend, ₹81 per attendee.",
    incremental_attendees: 1444, budget_inr: 167000, confidence: 0.7,
    kpis: "Pods per college, pod size, pod confirm rate, ₹ per confirmed",
    scale_rule: "≥4 pods per college and pod confirm ≥90% → release tranche 2 (+30 colleges)",
    change_rule: "<2 pods per college after 3 weeks → switch hook to department fests and competition-only entry",
    stop_rule: "₹ per confirmed >₹145 (1.4× the ₹104 plan) after 4 weeks → freeze new colleges, keep the top 20",
  },
  {
    bet_id: "B2", rank: 2, name: "Show-Up Engineering", call: "double_down",
    concept: "WhatsApp ladder T-7/T-3/T-1 with QR pass, calendar hold, day-slot choice, refundable ₹99 hold, waitlist auto-release at T-2. Attacks the biggest 2025 leak: 31% of registrants did not show.",
    incremental_attendees: 378, budget_inr: 45000, confidence: 0.6,
    kpis: "RSVP-yes, opt-outs, slot picks; show-rate lift vs 20% holdout",
    scale_rule: "RSVP-yes lift ≥8 pts vs 20% holdout → extend to all channels",
    change_rule: "Hold lowers completion by >10% → drop the hold for peer channels, keep reminders",
    stop_rule: "Opt-outs >8% or no RSVP lift → stop the ladder; keep only the T-1 QR pass",
  },
  {
    bet_id: "B3", rank: 3, name: "Ambassador + referral flywheel", call: "double_down",
    concept: "100 → 160 ambassadors on a weekly leaderboard; each confirmed registrant is asked to bring a squad (3 friends unlock fast lane + merch, ₹40 per referred attendee). Referrals were the cheapest 2025 channel (₹69).",
    incremental_attendees: 845, budget_inr: 119000, confidence: 0.55,
    kpis: "k (referred identified per registrant), share rate, identified per ambassador per week, referred reg→confirm",
    scale_rule: "k ≥0.25 and referred reg→confirm ≥85% → raise the unlock tier",
    change_rule: "k <0.15 after 2 weeks → change the reward (merch → fast lane + guest pass)",
    stop_rule: "Ambassadors with <5 identified per week for 2 weeks → reassign; cap the reward pool",
  },
  {
    bet_id: "B4", rank: 4, name: "Paid social → retargeting only", call: "deprioritise",
    concept: "Cut cold prospecting (₹1.1L → ₹80k); keep retargeting, attendee lookalikes and squad ads that feed pods. 2025: 50% show-rate, ₹274 per attendee.",
    incremental_attendees: -169, budget_inr: -35000, confidence: 0.4,
    kpis: "₹ per identified ≤ ₹110, reg→confirm ≥ 80%, frequency < 4",
    scale_rule: "₹ per confirmed ≤ portfolio (dashboard 'scale') → reopen budget in ₹10k steps",
    change_rule: "Dashboard verdict 'fix' (>130% of portfolio) → new creative + squad ads only",
    stop_rule: "Verdict 'stop' (≥175% and down-funnel ≥15 pts below portfolio) → pause; reallocate to pods",
  },
  {
    bet_id: "B5", rank: 5, name: "Creators: pay per verified attendee only", call: "reject",
    concept: "Reject flat-fee creator hype. Pay creators only per verified attendee (code + gate scan, ₹25k cap). 2025 flat fee: ₹337 per attendee at a 50% show-rate.",
    incremental_attendees: -69, budget_inr: -17000, confidence: 0.3,
    kpis: "Code registrations in week 1; code reg→confirm; ₹ per verified attendee",
    scale_rule: "₹ per verified ≤ ₹150 → offer a second deal",
    change_rule: "₹150–250 → move to squad-challenge content",
    stop_rule: ">₹250 per verified → end the deal (2025 flat fee was ₹337)",
  },
] as const;

export const SEED_TASKS = [
  { title: "Sign MoUs with 10 pilot colleges for College Pods", campaign_id: "C04", bet_id: "B1", owner_id: "T03", due_date: "2025-02-07", status: "done", priority: "high" },
  { title: "Launch inter-college pod league leaderboard", campaign_id: "C04", bet_id: "B1", owner_id: "T03", due_date: "2025-03-01", status: "done", priority: "medium" },
  { title: "Set up WhatsApp T-7/T-3/T-1 reminder ladder with 20% holdout", campaign_id: null, bet_id: "B2", owner_id: "T06", due_date: "2025-03-29", status: "doing", priority: "high" },
  { title: "Recruit 60 more campus ambassadors (100 → 160)", campaign_id: "C01", bet_id: "B3", owner_id: "T03", due_date: "2025-02-14", status: "done", priority: "medium" },
  { title: "Add squad referral ask to the post-confirmation page", campaign_id: "C05", bet_id: "B3", owner_id: "T06", due_date: "2025-03-08", status: "done", priority: "medium" },
  { title: "Cap cold prospecting spend; shift to retargeting audiences", campaign_id: "C02", bet_id: "B4", owner_id: "T04", due_date: "2025-03-22", status: "todo", priority: "medium" },
  { title: "Renegotiate creator deals to pay per verified attendee", campaign_id: "C03", bet_id: "B5", owner_id: "T05", due_date: "2025-03-20", status: "todo", priority: "high" },
] as const;
