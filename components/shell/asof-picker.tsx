"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { CalendarDays, Loader2 } from "lucide-react";

export type AsOfBounds = { min: string; max: string; eventDay: string; presets: { label: string; date: string; hint: string }[] };

export function AsOfPicker({ bounds }: { bounds: AsOfBounds }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const current = sp.get("asOf") ?? bounds.max;

  const go = (date: string) => {
    if (!date) return;
    const next = new URLSearchParams(sp.toString());
    next.set("asOf", date);
    start(() => router.push(`${pathname}?${next.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1">
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> : <CalendarDays className="h-4 w-4 text-zinc-400" />}
        <span className="text-xs text-zinc-500">As of</span>
        <input
          type="date"
          className="num bg-transparent text-sm font-medium text-zinc-900 outline-none"
          min={bounds.min}
          max={bounds.max}
          value={current}
          onChange={(e) => go(e.target.value)}
          aria-label="Snapshot date (end of day, IST)"
        />
      </div>
      <div className="flex overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {bounds.presets.map((p) => (
          <button
            key={p.label}
            title={p.hint}
            onClick={() => go(p.date)}
            className={clsx("border-r border-zinc-100 px-2 py-1 text-xs last:border-r-0", current === p.date ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-50")}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
