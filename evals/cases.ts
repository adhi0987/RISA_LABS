// Chatbot evaluation cases. Each conversation is a sequence of user turns sent with full history.
// Checks: `expect` regexes must ALL match the answer text; `tools` = at least one of these tools must be called;
// `notExpect` must not match. Expected numbers come from the engine's golden tests on the original dataset.

export type Turn = { q: string; expect?: RegExp[]; notExpect?: RegExp[]; tools?: string[] };
export type Case = { id: string; category: string; asOf: string; turns: Turn[] };

export const CASES: Case[] = [
  {
    id: "workflow",
    category: "complete workflow (diagnose → what-if → action → follow-up)",
    asOf: "2025-04-05",
    turns: [
      { q: "What should we scale or cut this week?", tools: ["get_campaigns", "get_overview"], expect: [/220/, /155/, /fix/i] },
      { q: "What if we move half of Creator Partners' remaining budget to College Partnerships?", tools: ["run_scenario"], expect: [/attendee/i, /assum/i] },
      { q: "OK, do it. Also create a task for Nisha Rao to move creator deals to pay-per-verified-attendee, due in 5 days.", tools: ["propose_actions"], expect: [/confirm/i] },
    ],
  },
  { id: "cant-college", category: "cannot answer", asOf: "2025-04-20", turns: [{ q: "Which college sent the most attendees?", expect: [/(no|not|doesn.t|does not|isn.t|unavailable)[^.]*college|college[^.]*(not|no|unavailable|isn.t)/i, /College Partnerships|C04/i] }] },
  { id: "cant-gender", category: "cannot answer", asOf: "2025-04-20", turns: [{ q: "What's the gender split of our attendees?", expect: [/(not|no|doesn.t|does not|unavailable)[^.]*(gender|demographic)|(gender|demographic)[^.]*(not|no|unavailable)/i], notExpect: [/\b\d{1,2}% (male|female)/i] }] },
  { id: "cant-creative", category: "cannot answer", asOf: "2025-04-20", turns: [{ q: "Which Instagram post or creative drove the most registrations?", expect: [/(not|no|doesn.t|does not|unavailable)[^.]*(creative|post|ad-level|ad level)|(creative|post)[^.]*(not|no|unavailable)/i] }] },
  { id: "headline", category: "calculation", asOf: "2025-04-20", turns: [{ q: "How many verified attendees did we get vs the goal, and what did each cost?", expect: [/2,?050/, /2,?200/, /134/] }] },
  { id: "noshow", category: "calculation", asOf: "2025-04-20", turns: [{ q: "How many registrants never showed up, and how many of those were confirmed?", expect: [/875/, /575/] }] },
  { id: "savings", category: "calculation", asOf: "2025-04-20", turns: [{ q: "If Paid Social had matched the portfolio cost per attendee, how much less would it have spent for the same attendees?", tools: ["calculate"], expect: [/₹?\s?4[5-9],?\d{3}|₹?\s?4\d\.\d+\s?k/i] }] },
  { id: "two-day", category: "breakdown", asOf: "2025-04-20", turns: [{ q: "What share of verified visitors came on both days?", tools: ["get_breakdown", "get_overview", "query_data"], expect: [/3[45](\.\d)?\s?%/] }] },
  { id: "t28", category: "snapshot", asOf: "2025-03-15", turns: [{ q: "How many people had registered by today and what is the registration goal?", expect: [/1,?562/, /3,?200/] }] },
  { id: "denied", category: "unfamiliar", asOf: "2025-04-20", turns: [{ q: "How many check-in attempts were denied at the gate?", expect: [/\b50\b/] }] },
  { id: "optout", category: "unfamiliar", asOf: "2025-04-20", turns: [{ q: "How many people opted out of nurture emails?", expect: [/229/] }] },
  {
    id: "followup",
    category: "follow-up",
    asOf: "2025-04-20",
    turns: [
      { q: "Which campaign had the worst show rate?", expect: [/Paid Social|Creator/i, /50(\.0)?\s?%/] },
      { q: "And how does that compare with the best one?", expect: [/College Partnerships/i, /85\.6|86\s?%/] },
    ],
  },
  { id: "pace", category: "projection", asOf: "2025-04-05", turns: [{ q: "Are we on track to hit the visitor goal? Give me the projected range.", expect: [/2,?200/, /project/i] }] },
  { id: "change", category: "trend", asOf: "2025-04-11", turns: [{ q: "What changed in the last 7 days and what's driving it?", tools: ["compare_snapshots", "get_trend"], expect: [/confirm|registr/i] }] },
  { id: "bottleneck", category: "diagnosis", asOf: "2025-04-20", turns: [{ q: "Where is the biggest bottleneck in the funnel?", expect: [/attend|show/i, /875|31(\.\d)?\s?%/] }] },
  { id: "future", category: "cannot answer", asOf: "2025-04-20", turns: [{ q: "How many people attended CampusFest 2026?", expect: [/(no|not|doesn.t|does not|isn.t)[^.]*(2026|data)|2026[^.]*(plan|not|no)/i], notExpect: [/2026[^.]{0,40}\battended\b[^.]{0,20}\d,?\d{3}/i] }] },
];
