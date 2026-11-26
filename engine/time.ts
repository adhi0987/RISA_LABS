// Time helpers. All business dates are Asia/Kolkata (IST, UTC+05:30, no DST).

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const EXCEL_EPOCH_OFFSET_DAYS = 25569; // days between 1899-12-30 and 1970-01-01

/** Excel serial number holding an IST wall-clock time → UTC epoch ms (rounded to the second). */
export function excelSerialToMs(serial: number): number {
  const wallClockAsUtc = (serial - EXCEL_EPOCH_OFFSET_DAYS) * DAY_MS;
  return Math.round((wallClockAsUtc - IST_OFFSET_MS) / 1000) * 1000;
}

/** Excel serial date → 'YYYY-MM-DD' (date part of the IST wall clock). */
export function excelSerialToDate(serial: number): string {
  const ms = Math.round((Math.floor(serial + 1e-9) - EXCEL_EPOCH_OFFSET_DAYS) * DAY_MS);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse ISO text; a bare date or a timestamp without an offset is read as IST. */
export function isoToMs(text: string): number {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Date.parse(`${t}T00:00:00+05:30`);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) return Date.parse(t);
  return Date.parse(`${t.replace(" ", "T")}+05:30`);
}

/** End of the selected IST day: 'YYYY-MM-DD' → epoch ms of 23:59:59.999 IST. */
export function endOfDayIst(date: string): number {
  return Date.parse(`${date}T23:59:59.999+05:30`);
}

/** Epoch ms → 'YYYY-MM-DD' in IST. */
export function msToIstDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch ms → 'YYYY-MM-DD HH:mm' in IST. */
export function msToIstLabel(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS);
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}
