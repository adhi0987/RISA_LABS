# CampusFest Growth Center

**Challenge A: Attendee Growth · Bengaluru** · RISA Growth APM assignment, Part 2

A working command center for the festival's attendee-growth team, with three parts:

- **Analytics dashboard.** Measures the full funnel as of any date.
- **Campaign and task manager.** Turns decisions into owned, dated work. Every change is saved and logged.
- **Embedded AI Growth Analyst.** Answers from the live application data, diagnoses problems, runs what-ifs, and proposes actions that only apply when a person clicks **Confirm**.

| | |
|---|---|
| Live app | `<deployment URL>` |
| Code | https://github.com/adhi0987/RISA_LABS |
| Strategy deck | `CampusFest_2026_Attendee_Growth_Strategy.pdf` (Part 1, three slides) |
| Original data | [`data/original/Attendee Dataset.xlsx`](data/original/Attendee%20Dataset.xlsx), kept unchanged for testing |

---

## 1. Try it in three minutes

1. **Overview.** Click **T-7** in the top bar. This shows everything known by the end of 5 Apr 2025, a week before the event. Later outcomes never leak into an earlier snapshot.
2. **Ask the Growth Analyst** (bottom right): *"What should we scale, fix or stop this week?"*
   - It calls `get_campaigns`. Creator Partners is **fix**: ₹220 per confirmed, 191% of the portfolio cost.
   - Paid Social is also **fix**: ₹155, 134%.
   - Referrals, Organic, College, Ambassadors and Community are **scale**.
3. **Follow-up:** *"What if we move half of Creator Partners' remaining budget to College Partnerships?"*
   - It calls `run_scenario`. Half of ₹9,700 is ₹4,850, worth about **+18 attendees**.
   - The assumptions are listed in the answer.
4. *"Do it, and create a task for Nisha Rao to move creator deals to pay-per-verified-attendee."*
   - Two proposal cards appear.
   - Click **Confirm**. The budgets change on **Campaigns**, the task appears on **Tasks**, and both appear in the **Activity log** as *ai (confirmed by user)*.
5. *"Which college sent the most attendees?"*
   - The analyst says the data has no college names.
   - It offers the closest proxy: the College Partnerships campaign, with 385 attendees at ₹81 each.
6. **Change the data.** On **Data**, edit a spend row, add a target version or append a cancellation, then ask again. The numbers change.
7. **Restore.** **Data → Reset** restores the original workbook.

---

## 2. What maps to the brief

| Assignment requirement | Where it lives |
|---|---|
| **Measure:** full funnel, campaign KPIs, targets vs actuals, conversion, budgets, projections | **Overview**: KPIs vs the active target version with a linear pace marker, the funnel (anonymous events kept separate from distinct people), spend vs budget, and a projection band. **Campaigns**: the per-campaign funnel and ₹ per stage. |
| **Diagnose:** winners, under-performers, bottlenecks, drivers of change | **Verdict engine** (scale / maintain / fix / stop / watch, with reasons). **Bottleneck finder** (the worst stage, plus each campaign's *excess people lost* vs the portfolio rate). **Rules & backtest** (verdicts replayed at T-28, T-14, T-7 and Final). The AI's `compare_snapshots` tool explains week-over-week change. |
| **Decide:** prioritise, allocate, scale / change / stop | Verdicts with thresholds (editable in **Settings**), the scenario tool, budget reallocation, and the **2026 Planner** (base vs stretch and the ranked bets). |
| **Execute:** campaigns, tasks, owners, deadlines, action items; edits update analytics | **Campaigns** (status, budget, owner, notes, moving budget). **Tasks** (create, edit, delete, status, owner, due date, link to a campaign or bet, overdue vs the as-of date). **Data** (edit source rows). Every write bumps a data version, so the dashboard and the AI recompute. |
| **AI analyst:** grounded, analytical, recommends, connects to execution, honest about uncertainty | `/api/chat` with 11 tools over the same engine as the dashboard. Arithmetic goes through a `calculate` tool. A guarded read-only SQL tool handles unfamiliar questions. Proposals apply only on **Confirm**. A list of known data gaps is built into the instructions. |
| **One complete workflow** | Section 1, steps 2–4: diagnose → what-if → propose → confirm → tasks and budgets updated → audit log. |
| **Persistent changes, reliable updates** | Postgres (Supabase). Every write is one transaction: change + audit row + version bump. |

---

## 3. How the numbers are computed

All metrics come from one pure TypeScript engine ([`engine/`](engine/)). The dashboard **and** every AI tool call it, so the two can never disagree.

### Data rules

These follow the dataset's "Read me" and field guide.

**Snapshot cutoff**
- An as-of date *D* means the end of day *D* in IST (23:59:59.999 +05:30).
- Every timestamp must be at or before the cutoff. Daily rows count when `activity_date ≤ D`.
- Excel serial dates are IST wall-clock times. They are converted to exact instants.

**De-duplication**
- Identical stable IDs from import retries are counted once:
  - 4 registration-history versions
  - 20 check-ins
  - 2 daily-marketing rows
- The **Data** page shows a health report with these counts.

**Latest-version semantics**
- Registration status is the latest `registration_history` version at or before the cutoff for each `registration_id`.
- Targets use the latest version effective by the cutoff. The revised plan starts 15 Mar 2025 09:00 IST.

**Attendance**
- An attendee is an **external** person with a check-in that is **admitted + verified**, counted once per `person_id`.
- Manual and scanner records overlap. Internal, staff and test people are excluded, and so are denied and pending check-ins.

**Attribution**
- Identified people count toward their first-touch campaign.
- Registrations, confirmations and attendance count toward the campaign recorded on the registration.
- The 125 walk-ins are *unattributed*. That does not mean they cost nothing.

**Anonymous counts**
- Impressions, clicks, reach, sessions and form starts are platform events. They are never summed into "people".

**Spend**
- Spend is net posted spend; negative rows are vendor credits.
- Per-campaign budgets are **not** in the source. They are an *assumption*: the ₹3,00,000 approved budget split by each campaign's share of 2025 spend. All of them are editable.

### Verdict engine

Defined in `engine/metrics.ts` as `THRESHOLDS`, and editable in **Rules & backtest**.

**Cost metric:** ₹ per confirmed registration before the event, because attendance can't be observed yet, and ₹ per verified attendee after it. In both cases the campaign is compared with the portfolio.

| Verdict | Rule |
|---|---|
| **scale** | cost ≤ 100% of portfolio |
| **maintain** | 100–130% |
| **fix** | above 130% |
| **stop** | ≥ 175% **and** down-funnel ≥ 15 points below portfolio |
| **watch** | fewer than 15 confirmed registrations |

*Down-funnel* means registered→confirmed before the event and registered→attended after it.

There are two separate flags: *over budget*, and *spending ahead of plan*. The second fires when the share of budget used runs more than 15 points ahead of the share of the planned window that has elapsed.

### Golden numbers

These are reproduced exactly from the original data and enforced by `npm test`.

**Final result**

| Metric | Value |
|---|---|
| Verified external visitors | **2,050**, against a goal of 2,200 (93%) |
| Net spend | **₹2,74,000** |
| Cost per attendee | **₹134** |
| External registrants | **2,800** |
| Registrants who never attended | **875**, of whom **575** were last "confirmed" |

The biggest leak is registered → attended, at 31%.

**Per campaign**

| Campaign | Identified | Registered | Attended | Spend | ₹ per attendee | Final verdict |
|---|---|---|---|---|---|---|
| C04 College Partnerships | 500 | 450 | 385 | ₹31,000 | ₹81 | scale |
| C05 Student Referrals | 410 | 350 | 275 | ₹19,000 | ₹69 | scale |
| C06 Organic Search | 290 | 250 | 195 | ₹14,000 | ₹72 | scale |
| C07 Community Groups | 250 | 200 | 165 | ₹16,000 | ₹97 | scale |
| C01 Campus Ambassadors | 600 | 520 | 390 | ₹42,000 | ₹108 | scale |
| C02 Paid Social | 960 | 680 | 340 | ₹93,000 | ₹274 | **stop** (205%, show-rate 50% vs 68.75%) |
| C03 Creator Partners | 490 | 350 | 175 | ₹59,000 | ₹337 | **stop** (252%) |

**Backtest** (`/settings`)

| Snapshot | Portfolio ₹ per confirmed | Creator Partners | Paid Social |
|---|---|---|---|
| T-28 (15 Mar) | ₹148.2 | **fix**: ₹314 (212%) | **maintain**: ₹149 (101%) |
| T-7 (5 Apr) | ₹115.4 | **fix**: ₹220 (191%) | **fix**: ₹155 (134%) |
| Final | — | **stop**: ₹337 per attendee | **stop**: ₹274 per attendee |

Creators is above the 175% stop line at T-28 and T-7, yet the call is "fix". That's because its registered→confirmed gap is only 6.3 and 5.3 points, below the 15-point stop condition. The leading indicator flagged both weak channels 7–28 days before any attendance existed.

### Projection (before the event)

- Registrations continue at the trailing 7-day run rate until event day.
- The current confirm rate holds for new registrations.
- Confirmed people attend at a show-rate band of 65 / 72 / 80% (low / mid / high). This band is an *assumption*.
- Walk-ins add 6.5%, the 2025 ratio.
- After the event, the projection is the observed result.

### Scenario model (`run_scenario`)

- **Added spend** converts at **80%** of the campaign's current ₹ per confirmed. This is an assumption for diminishing returns.
- **Removed spend** loses confirmations at the campaign's current average cost.
- **Attendees** are confirmations × the mid show-rate before the event, or × the observed attended ÷ confirmed ratio after it.
- **Baseline** is what is confirmed at the snapshot, so a delta isolates the change itself.
- Every result lists its assumptions. It is not a causal estimate.

### 2026 Planner

It reproduces Slide 1 from **live** 2025 benchmarks (`engine/planner.ts`, tested).

**How each segment is calculated**
- identified = reach driver
- registered = identified × the 2025 registration rate of the benchmark channel
- attendees = registered × the 2025 show-rate, plus the Show-Up uplift in the stretch case (3–12 points)
- spend = identified × 2025 cost per identified × **1.15** (a Bengaluru inflation *assumption*)
- Paid social and creator spend are inputs. Referrals are k × the registrants from every other segment.

**Results**
- Base: **3,145** attendees for ₹3.93L.
- Stretch: **5,575** for ₹6.75L. That includes ₹85k of programmes: ₹40k pod prizes and the ₹45k show-up stack.
- Venue ceiling: 6,000 per day × 2 ÷ (1 + the 35.4% two-day share) = **8,865**. The two-day share is computed from the data.

**Bet ranking** (Slide 2)
- Score = incremental attendees × confidence ÷ cost in ₹ lakh, computed live.
- *Note:* the deck's Show-Up Engineering score of 475 differs from the formula, which gives 378 × 0.60 ÷ 0.45 = **504**. The ranking is unchanged.

---

## 4. Strategy in one page (Part 1 summary)

**Why Bengaluru**
- Bengaluru Urban has 1,106 colleges, the most of any district (AISHE 2021-22).
- At about 433 students per college that is ≈ 4.8 lakh addressable students.
- The city has a proven fest culture, with 10,000–15,000 footfall at major college fests.
- Instagram CPMs in India run ₹45–400, and 2025 paid CPM was ₹286.

**Target**
- Stretch of **5,575** verified attendees, 2.7× 2025, at a *lower* cost per attendee (₹121 vs ₹134).
- Base of **3,145**.
- The stretch is won through **deeper conversion, not more reach**: reach grows 6% while attendees grow 77%.

**Bets and prioritisation framework**

| # | Bet | Call | Δ attendees | Budget |
|---|---|---|---|---|
| 1 | College Pods | double down | +1,444 | ₹1.67L |
| 2 | Show-Up Engineering | double down | +378 | ₹45k |
| 3 | Ambassador + referral flywheel | double down, gated | +845 | ₹1.19L |
| 4 | Paid social → retargeting only | deprioritise | — | — |
| 5 | Creators, pay per verified attendee only | reject flat fees | — | — |

- Bets are ranked by priority score = incremental attendees × confidence ÷ cost.
- They are sequenced to avoid double counting: referrals follow pods, and show-up is sized last because it multiplies every channel.

**Experimentation**
- Every bet is steered by a leading indicator within 2 weeks.
- Each has pre-set scale / change / stop lines, stored in the `bets` table and shown in the Planner.
- The weekly cadence: Monday snapshot review → AI diagnosis → confirm actions → tasks with owners and deadlines → Friday indicator check.

**Sources** (as cited in the deck)
- AISHE 2021-22 via PTI/Udayavani: Bengaluru Urban has 1,106 colleges.
- AISHE 2023-24 via Deccan Herald: Karnataka averages 433 enrolment per college.
- TOI via inkl: Mount Carmel Cul-Ah, about 10,000 footfall.
- Citizen Matters: Esplendida, about 15,000.
- upGrowth 2026: Instagram India CPM ₹45–400.
- CampusFest 2025 attendee dataset: all channel benchmarks.

**Sourced facts vs assumptions**

| Sourced (data or cited) | Assumption (labelled in the app) |
|---|---|
| Channel conversion rates, costs, show-rates, walk-in share, two-day share (2025 dataset) | Reach drivers (colleges, ambassadors, groups, k), Show-Up uplift (3–12 points), inflation 1.15 |
| Targets and budget versions (dataset) | Per-campaign budget split, projection show-rate band, scenario marginal efficiency (80%) |
| College counts, fest footfall, CPM range (cited) | Venue capacity of 6,000 per day, confidence weights, programme costs |

---

## 5. Architecture and the trade-offs behind it

```
Browser ── Next.js 16 (App Router, Vercel, region syd1)
            ├─ Server components → engine/ (pure TS: snapshot · verdicts · series · scenario · planner)
            ├─ Server actions → lib/data/mutations (transaction + audit_log + data_version++)
            └─ /api/chat → Vercel AI SDK 7 streamText + 11 tools → same engine
                     └─ Gemini (primary) ⇄ Gemini lite (fallback)
Supabase Postgres (session pooler)
  app.*        working copy of the dataset + tasks, bets, proposals, audit log, settings
  analytics.*  read-only views; role analyst_ro is the only thing the AI's SQL tool can use
```

**Compute in memory, cached by version**
- The dataset is about 28k rows. Each server instance loads it **once per `data_version`** and computes any snapshot in milliseconds.
- So a request costs one tiny version query, while every write invalidates the cache everywhere.
- SQL materialized views would add a lot of complexity for no gain at this size. If the data grew 100×, the engine would move into SQL.

**One engine, two consumers.** The UI and the AI tools call the same functions, which removes a whole class of "the chatbot said a different number" bugs.

**Running on free tiers**
- Coarse tools mean a typical answer is 2 model calls. Tool outputs are compact, with rounded values and units in the key names.
- The static system prompt comes first, which is friendly to implicit caching.
- Thinking level is set to *low*. The step cap is 6.
- Older turns keep only their text in the history; tool details are dropped.
- Each visitor gets 15 messages per 10 minutes, and there is a daily call cap, both as Postgres counters with no extra service.

**Resilience**
- If the primary Gemini model errors (429 / 5xx) **or produces nothing for 12 s**, the call is replayed on the fallback model.
- A 3-minute circuit breaker then skips the primary, so later steps don't wait again.
- The primary was overloaded during development, which is exactly why this exists.
- Dataset loads time out and serve the last good copy instead of hanging.

**Why the session pooler**
- Supabase's *transaction* pooler returned cross-wired result sets for pipelined queries in testing. Interaction rows came back with 0 rows, and the daily rows came back with the check-in count.
- The app therefore uses the session pooler.

**Security**
- Tables live in a private `app` schema, which Supabase's REST API doesn't expose.
- The Gemini key is server-only.
- The SQL tool is locked down:
  - single SELECT/WITH only
  - keyword denylist
  - analytics views only
  - `SET LOCAL ROLE analyst_ro`
  - read-only transaction
  - 4 s statement timeout
  - 200-row cap
- AI writes are proposals only.

---

## 6. The AI Growth Analyst

**Tools**

| Tool | Purpose |
|---|---|
| `get_overview` | Funnel, targets and pacing, unit economics, bottleneck, projection, verdict summary |
| `get_campaigns` | Per-campaign metrics, verdict and reasons, budget, remaining budget, owner |
| `get_trend` | Daily or weekly series of 11 metrics, optionally for one campaign |
| `compare_snapshots` | What changed between two dates, including the marginal ₹ per net new confirmed |
| `get_breakdown` | Check-in source overlap, results, person types, first touch, engagement, email funnel, day 1 / day 2, lead time |
| `run_scenario` | What-ifs on budget, confirm-rate and show-rate, with assumptions and warnings |
| `get_tasks` | Execution status; "overdue" is measured against the campaign clock |
| `get_plan_2026` | Base vs stretch model and the ranked bets |
| `query_data` | Guarded read-only SQL over the `analytics` views, for unfamiliar questions |
| `calculate` | Exact arithmetic (mathjs with a restricted scope); the model never does mental maths |
| `propose_actions` | Create or update tasks, update campaigns, move budget, as **pending** proposals that need Confirm |

**Behaviour rules** (in [`lib/ai/prompt.ts`](lib/ai/prompt.ts))
- Every number must come from a tool result.
- Fresh numbers are fetched for every question, because data changes.
- Evidence, assumptions and recommendations are labelled separately.
- When a question can't be answered, the first sentence says so, and the answer offers the nearest proxy.

The listed gaps:
- demographics
- college names or per-college data
- creative or post-level results
- ticket revenue
- satisfaction data
- unique reach
- causal lift
- 2026 actuals

**Follow-ups**
- The conversation is kept, and the as-of date and current page travel with every message.
- The model is told the status (applied, rejected or pending) of proposals it made earlier.

**Evaluation**
- `npm run eval` runs multi-turn conversations against `/api/chat`, the same way the browser does.
- Categories: the full workflow, cannot-answer, calculations, snapshots, unfamiliar questions, follow-ups, projection, trend, diagnosis.
- Results are in section 8.

---

## 7. Setup

**Prerequisites:** Node 22, a Supabase project (free tier), and a Gemini API key from Google AI Studio (free tier).

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run db:setup               # applies db/schema.sql and loads data/original/Attendee Dataset.xlsx
npm run dev                    # http://localhost:3000
npm test                       # golden-number tests (engine, planner)
npm run eval                   # chatbot eval (needs the dev server running)
```

**Environment variables**

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Supabase **session pooler** URI (port 5432) |
| `DIRECT_URL` | The same URI, used by the setup script |
| `GEMINI_API_KEY` | Google AI Studio key |
| `GEMINI_MODEL_PRIMARY` / `GEMINI_MODEL_FALLBACK` | e.g. `gemini-3.6-flash` / `gemini-3.5-flash-lite` |
| `AI_DAILY_CALL_CAP` | Daily model-call budget for the public demo (default 600) |
| `EVAL_TOKEN` | Lets the eval runner bypass the per-visitor limit |
| `CRON_SECRET` | Optional; Vercel cron secret |

**Deploy**
- Import the GitHub repo into Vercel, add the variables above, and deploy.
- `vercel.json` pins the functions to `syd1`, next to the Supabase region, and schedules a daily `/api/health` ping that keeps the free database from pausing.

---

## 8. Testing and verification

- **Unit and golden tests** (`npm test`, Vitest):
  - ingest de-duplication and IST conversion
  - every deck number
  - backtest verdicts at T-28, T-7 and final
  - the target-version switch
  - no leakage into earlier snapshots
  - changed data flowing through
  - the planner reproducing 3,145 and 5,575
  - the 8,865 ceiling and the two-day share
- **Chatbot eval** (`npm run eval`): `<results>`
- **End to end:**
  - the workflow in section 1 was run through the API, and proposals were applied through the same code path as the Confirm button
  - budgets moved by exactly ₹4,850
  - an AI-sourced task was created
  - audit rows were written
  - the data version bumped, so the dashboards refreshed

---

## 9. Tools used

| Tool | Plan | Role |
|---|---|---|
| Next.js 16, React 19, Tailwind CSS 4 | open source | App, UI |
| Vercel | Hobby (free) | Hosting, cron |
| Supabase Postgres | Free | Persistence |
| Google Gemini API (`gemini-3.6-flash`, `gemini-3.5-flash-lite`) | Free tier | AI analyst |
| Vercel AI SDK 7 (`ai`, `@ai-sdk/google`, `@ai-sdk/react`) | open source | Tool loop, streaming, chat hook |
| postgres.js, SheetJS, mathjs, Recharts, zod, react-markdown | open source | DB driver, xlsx ingest, safe maths, charts, validation, chat rendering |
| Vitest, tsx | open source | Tests, scripts |
| Claude Code (Anthropic) | — | AI pair-programmer for implementation; all numbers verified by the tests above |

**Reused vs built:**
- The `create-next-app` scaffold was reused.
- Everything else was written for this project: the engine, schema, UI, tools, prompts and evals.

---

## 10. Known limitations

**Data and modelling**
- The data is synthetic and covers one past event (2025). The "live" campaign is a replay of it on the as-of timeline.
- Management fields are **current-state only**. Budgets, campaign status and tasks are not versioned in time, so a past snapshot shows today's budgets. Source data *is* fully time-aware.
- Per-campaign budgets, the projection show-rate band and the scenario's marginal efficiency are assumptions. They are labelled in the UI and editable.
- The scenario model is linear and correlational: it is not a causal or media-mix model.
- Attribution follows the dataset's recorded source. No multi-touch model is used.

**App and AI**
- The demo is open, with no login. It is rate-limited, and "Reset" is available to anyone.
- Free-tier Gemini can be rate-limited or overloaded. The fallback model and the breaker reduce the impact; the dashboard never depends on the AI.
- The AI can still misread a question. Tool chips under each answer show exactly what data was used, so a person can check.
