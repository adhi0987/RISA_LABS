// Display formatting (Indian number system).
export function inr(x: number | null | undefined, opts: { compact?: boolean; decimals?: number } = {}): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const sign = x < 0 ? "−" : "";
  const a = Math.abs(x);
  if (opts.compact) {
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)}Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)}L`;
    if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  }
  return `${sign}₹${a.toLocaleString("en-IN", { maximumFractionDigits: opts.decimals ?? 0, minimumFractionDigits: opts.decimals ?? 0 })}`;
}

export function num(x: number | null | undefined, decimals = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

/** x is a fraction (0.42 → "42%") */
export function pct(x: number | null | undefined, decimals = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(decimals)}%`;
}

/** x already in percent units (42 → "42%") */
export function pctUnits(x: number | null | undefined, decimals = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${x.toFixed(decimals)}%`;
}

export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function istDateTime(ms: number | string | Date): string {
  const d = new Date(ms);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
