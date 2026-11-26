// Parse the CampusFest attendee workbook (xlsx) into normalized, de-duplicated rows.
// Used by the seed script and by the in-app "Reset" / "Import" admin routes.
import * as XLSX from "xlsx";
import type {
  Campaign, Checkin, Daily, Dataset, EventInfo, Interaction, Owner, Person, RegHistory, Registration, RegStatus, Target,
} from "@/engine/types";
import { excelSerialToDate, excelSerialToMs, isoToMs } from "@/engine/time";

export type TableHealth = {
  table: string;
  sourceRows: number;
  importCopiesRemoved: number; // same stable ID, identical payload
  conflictingDuplicates: number; // same stable ID, different payload (last one kept)
  keptRows: number;
};

export type HealthReport = {
  parsedAt: string;
  fileName: string;
  tables: TableHealth[];
  notes: string[];
};

const SHEETS = {
  event: ["Event", "event"],
  targets: ["Targets", "targets"],
  campaigns: ["Campaigns", "campaigns"],
  daily: ["Daily Marketing", "campaign_daily"],
  people: ["People", "people"],
  interactions: ["Interest and Engagement", "lead_interactions"],
  registrations: ["Registrations", "registrations"],
  history: ["Registration History", "registration_history"],
  checkins: ["Check-ins", "checkins"],
} as const;

type Row = Record<string, unknown>;

function sheetRows(wb: XLSX.WorkBook, key: keyof typeof SHEETS): Row[] {
  const name = SHEETS[key].find((n) => wb.SheetNames.includes(n));
  if (!name) throw new Error(`Workbook is missing the "${SHEETS[key][0]}" sheet.`);
  const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { raw: true, defval: null, blankrows: false });
  // Drop rows that are entirely empty (formatted-but-blank rows).
  return rows.filter((r) => Object.values(r).some((v) => v !== null && v !== ""));
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const strOrNull = (v: unknown): string | null => {
  const s = str(v);
  return s === "" ? null : s;
};
const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
function ts(v: unknown, field: string): number {
  if (typeof v === "number") return excelSerialToMs(v);
  if (typeof v === "string" && v.trim()) {
    const ms = isoToMs(v);
    if (!Number.isNaN(ms)) return ms;
  }
  if (v instanceof Date) return v.getTime();
  throw new Error(`Invalid timestamp in field ${field}: ${String(v)}`);
}
const tsOrNull = (v: unknown, field: string): number | null => (v === null || v === "" ? null : ts(v, field));
function date(v: unknown, field: string): string {
  if (typeof v === "number") return excelSerialToDate(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  throw new Error(`Invalid date in field ${field}: ${String(v)}`);
}

function dedupe<T>(table: string, rows: T[], idOf: (r: T) => string): { rows: T[]; health: TableHealth } {
  const byId = new Map<string, { row: T; json: string }>();
  let copies = 0;
  let conflicts = 0;
  for (const row of rows) {
    const id = idOf(row);
    if (!id) continue;
    const json = JSON.stringify(row);
    const prev = byId.get(id);
    if (prev) {
      if (prev.json === json) copies++;
      else conflicts++;
    }
    byId.set(id, { row, json });
  }
  return {
    rows: [...byId.values()].map((v) => v.row),
    health: { table, sourceRows: rows.length, importCopiesRemoved: copies, conflictingDuplicates: conflicts, keptRows: byId.size },
  };
}

export type ParsedDataset = Dataset & { health: HealthReport };

export function parseWorkbook(buffer: ArrayBuffer | Uint8Array | Buffer, fileName = "Attendee Dataset.xlsx"): ParsedDataset {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const health: TableHealth[] = [];
  const owners = new Map<string, string>();
  const noteOwner = (id: unknown, name: unknown) => {
    const i = str(id);
    const n = str(name);
    if (i && n && !owners.has(i)) owners.set(i, n);
  };

  // Event (single row)
  const ev = sheetRows(wb, "event")[0];
  if (!ev) throw new Error("Event sheet is empty.");
  const event: EventInfo = {
    event_name: str(ev.event_name),
    history_start: date(ev.history_start, "history_start"),
    history_end: date(ev.history_end, "history_end"),
    event_starts_at: ts(ev.event_starts_at, "event_starts_at"),
    event_ends_at: ts(ev.event_ends_at, "event_ends_at"),
    timezone: str(ev.timezone) || "Asia/Kolkata",
    currency: str(ev.currency) || "INR",
  };

  const targets: Target[] = sheetRows(wb, "targets")
    .map((r) => ({
      effective_at: ts(r.effective_at, "targets.effective_at"),
      identified_external_people_goal: num(r.identified_external_people_goal),
      registration_goal: num(r.registration_goal),
      unique_external_visitors_goal: num(r.unique_external_visitors_goal),
      marketing_budget_inr: num(r.marketing_budget_inr),
      target_version: str(r.target_version),
      origin: "source",
    }))
    .sort((a, b) => a.effective_at - b.effective_at);

  const campaignsRaw = sheetRows(wb, "campaigns");
  campaignsRaw.forEach((r) => noteOwner(r.owner_id, r.owner_name));

  const dailyRaw = sheetRows(wb, "daily").map((r) => {
    noteOwner(r.owner_id, r.owner_name);
    return {
      activity_id: str(r.activity_id),
      campaign_id: str(r.campaign_id),
      owner_id: strOrNull(r.owner_id),
      activity_date: date(r.activity_date, "activity_date"),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      reported_reach: num(r.reported_reach),
      landing_page_sessions: num(r.landing_page_sessions),
      registration_starts: num(r.registration_starts),
      marketing_spend_inr: num(r.marketing_spend_inr),
      platform: strOrNull(r.platform),
    } satisfies Daily;
  });
  const daily = dedupe("Daily Marketing", dailyRaw, (r) => r.activity_id);
  health.push(daily.health);

  const peopleRaw = sheetRows(wb, "people").map((r) => {
    noteOwner(r.owner_id, r.owner_name);
    return {
      person_id: str(r.person_id),
      person_name: str(r.person_name),
      person_type: str(r.person_type).toLowerCase(),
      first_seen_at: ts(r.first_seen_at, "first_seen_at"),
      first_touch_source: strOrNull(r.first_touch_source),
      first_campaign_id: strOrNull(r.first_campaign_id),
      owner_id: strOrNull(r.owner_id),
    } satisfies Person;
  });
  const people = dedupe("People", peopleRaw, (r) => r.person_id);
  health.push(people.health);

  const interRaw = sheetRows(wb, "interactions").map(
    (r) =>
      ({
        interaction_id: str(r.interaction_id),
        person_id: str(r.person_id),
        campaign_id: strOrNull(r.campaign_id),
        owner_id: strOrNull(r.owner_id),
        occurred_at: ts(r.occurred_at, "interactions.occurred_at"),
        event_type: str(r.event_type),
        detail: strOrNull(r.detail),
      }) satisfies Interaction,
  );
  const interactions = dedupe("Interest and Engagement", interRaw, (r) => r.interaction_id);
  health.push(interactions.health);

  const regRaw = sheetRows(wb, "registrations").map(
    (r) =>
      ({
        registration_id: str(r.registration_id),
        person_id: str(r.person_id),
        campaign_id: strOrNull(r.campaign_id),
        owner_id: strOrNull(r.owner_id),
        registered_at: ts(r.registered_at, "registered_at"),
      }) satisfies Registration,
  );
  const registrations = dedupe("Registrations", regRaw, (r) => r.registration_id);
  health.push(registrations.health);

  const histRaw = sheetRows(wb, "history").map(
    (r) =>
      ({
        history_id: str(r.history_id),
        registration_id: str(r.registration_id),
        person_id: strOrNull(r.person_id),
        campaign_id: strOrNull(r.campaign_id),
        owner_id: strOrNull(r.owner_id),
        effective_at: ts(r.effective_at, "history.effective_at"),
        status: str(r.status).toLowerCase() as RegStatus,
      }) satisfies RegHistory,
  );
  const history = dedupe("Registration History", histRaw, (r) => r.history_id);
  health.push(history.health);

  const chkRaw = sheetRows(wb, "checkins").map(
    (r) =>
      ({
        event_id: str(r.event_id),
        person_id: str(r.person_id),
        registration_id: strOrNull(r.registration_id),
        campaign_id: strOrNull(r.campaign_id),
        owner_id: strOrNull(r.owner_id),
        occurred_at: ts(r.occurred_at, "checkins.occurred_at"),
        result: str(r.result).toLowerCase(),
        verification: str(r.verification).toLowerCase(),
        source: strOrNull(r.source),
      }) satisfies Checkin,
  );
  const checkins = dedupe("Check-ins", chkRaw, (r) => r.event_id);
  health.push(checkins.health);

  // Campaign budgets are NOT in the source. Assumption: split the latest approved budget by each
  // campaign's share of recorded spend (2025 mix), rounded to ₹100.
  const spendByCampaign = new Map<string, number>();
  for (const d of daily.rows) spendByCampaign.set(d.campaign_id, (spendByCampaign.get(d.campaign_id) ?? 0) + d.marketing_spend_inr);
  const totalSpend = [...spendByCampaign.values()].reduce((a, b) => a + b, 0);
  const latestBudget = targets.length ? targets[targets.length - 1].marketing_budget_inr : 0;

  const campaigns: Campaign[] = campaignsRaw.map((r) => {
    const id = str(r.campaign_id);
    const share = totalSpend > 0 ? (spendByCampaign.get(id) ?? 0) / totalSpend : 0;
    return {
      campaign_id: id,
      campaign_name: str(r.campaign_name),
      channel: str(r.channel),
      target_audience: str(r.target_audience),
      objective: str(r.objective),
      owner_id: str(r.owner_id),
      created_at: ts(r.created_at, "campaigns.created_at"),
      planned_start_at: tsOrNull(r.planned_start_at, "planned_start_at"),
      planned_end_at: tsOrNull(r.planned_end_at, "planned_end_at"),
      status: "active",
      budget_inr: Math.round((latestBudget * share) / 100) * 100,
      notes: "",
    };
  });

  const ownerList: Owner[] = [...owners.entries()].map(([owner_id, owner_name]) => ({ owner_id, owner_name })).sort((a, b) => a.owner_id.localeCompare(b.owner_id));

  const notes = [
    "Exact repeated stable IDs (import retries) were counted once.",
    "Campaign budgets are an assumption: the latest approved marketing budget split by each campaign's share of recorded spend.",
  ];
  const conflictTotal = health.reduce((a, h) => a + h.conflictingDuplicates, 0);
  if (conflictTotal > 0) notes.push(`${conflictTotal} rows shared an ID with different values; the last row in the file was kept.`);

  return {
    event,
    targets,
    owners: ownerList,
    campaigns,
    daily: daily.rows,
    people: people.rows,
    interactions: interactions.rows,
    registrations: registrations.rows,
    history: history.rows,
    checkins: checkins.rows,
    health: { parsedAt: new Date().toISOString(), fileName, tables: health, notes },
  };
}
