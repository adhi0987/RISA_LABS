// Presentational primitives (server-safe, no client state).
import clsx from "clsx";
import type { ReactNode } from "react";
import type { VerdictCall } from "@/engine/metrics";

export function Card({ title, subtitle, action, children, className }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-xl border border-zinc-200 bg-white shadow-sm", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-zinc-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

const VERDICT_STYLE: Record<VerdictCall, string> = {
  scale: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  maintain: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  fix: "bg-amber-50 text-amber-800 ring-amber-200",
  stop: "bg-rose-50 text-rose-700 ring-rose-200",
  watch: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function VerdictBadge({ call, className }: { call: VerdictCall; className?: string }) {
  return <span className={clsx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset", VERDICT_STYLE[call], className)}>{call}</span>;
}

export function Badge({ children, tone = "zinc", className }: { children: ReactNode; tone?: "zinc" | "emerald" | "amber" | "rose" | "sky" | "violet" | "indigo"; className?: string }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    sky: "bg-sky-50 text-sky-700 ring-sky-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  } as const;
  return <span className={clsx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}

export function Progress({ value, marker, tone = "indigo" }: { value: number | null; marker?: number | null; tone?: "indigo" | "emerald" | "amber" | "rose" }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = { indigo: "bg-indigo-500", emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500" }[tone];
  return (
    <div className="relative h-1.5 w-full rounded-full bg-zinc-100">
      <div className={clsx("h-1.5 rounded-full", color)} style={{ width: `${v}%` }} />
      {marker !== undefined && marker !== null && (
        <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-zinc-500" style={{ left: `${Math.max(0, Math.min(100, marker))}%` }} title="Expected by now (linear pace)" />
      )}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div>
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className={clsx("num mt-0.5 text-2xl font-semibold tracking-tight", tone === "good" && "text-emerald-700", tone === "bad" && "text-rose-700", (!tone || tone === "neutral") && "text-zinc-900")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx("whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500", className)}>{children}</th>;
}
export function Td({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return <td title={title} className={clsx("whitespace-nowrap px-2 py-2 text-sm text-zinc-800", className)}>{children}</td>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-zinc-500">{children}</p>;
}

export function Assumption({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200" title="Assumption, not source data">
      assumption{children ? <>: {children}</> : null}
    </span>
  );
}
