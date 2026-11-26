"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Activity, BarChart3, ClipboardList, Database, Gauge, Megaphone, Settings2 } from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/planner", label: "2026 Planner", icon: BarChart3 },
  { href: "/data", label: "Data", icon: Database },
  { href: "/activity", label: "Activity log", icon: Activity },
  { href: "/settings", label: "Rules & backtest", icon: Settings2 },
];

export function Sidebar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const asOf = sp.get("asOf");
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
      <div className="px-4 pb-3 pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">CampusFest · Bengaluru</div>
        <div className="mt-0.5 text-base font-semibold text-zinc-900">Growth Center</div>
        <div className="text-xs text-zinc-500">Attendee growth command center</div>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={asOf ? `${href}?asOf=${asOf}` : href}
              className={clsx(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm",
                active ? "bg-indigo-50 font-medium text-indigo-700" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-zinc-100 p-4 text-[11px] leading-relaxed text-zinc-400">
        Source: CampusFest 2025 attendee dataset (synthetic). Planning figures are labelled as assumptions.
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const asOf = sp.get("asOf");
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 py-1.5 md:hidden">
      {NAV.map(({ href, label }) => (
        <Link key={href} href={asOf ? `${href}?asOf=${asOf}` : href} className={clsx("whitespace-nowrap rounded-md px-2 py-1 text-xs", (href === "/" ? pathname === "/" : pathname.startsWith(href)) ? "bg-indigo-50 text-indigo-700" : "text-zinc-600")}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
