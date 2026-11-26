import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/shell/sidebar";
import { AsOfPicker, type AsOfBounds } from "@/components/shell/asof-picker";
import { AiPanel } from "@/components/ai/panel";
import { getDataset } from "@/lib/data/dataset";
import { addDays, msToIstDate } from "@/engine/time";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CampusFest Growth Center",
  description: "Attendee growth command center: funnel analytics, campaign and task management, and an AI growth analyst.",
};

async function bounds(): Promise<AsOfBounds> {
  const { dataset } = await getDataset();
  const ev = dataset.event;
  const eventDay = msToIstDate(ev.event_starts_at);
  return {
    min: ev.history_start,
    max: ev.history_end,
    eventDay,
    presets: [
      { label: "T-28", date: addDays(eventDay, -28), hint: "4 weeks before the event" },
      { label: "T-7", date: addDays(eventDay, -7), hint: "1 week before the event" },
      { label: "Day 1", date: eventDay, hint: "End of event day 1" },
      { label: "Final", date: ev.history_end, hint: "Last day in the data" },
    ],
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  let b: AsOfBounds | null = null;
  let dbError: string | null = null;
  try {
    b = await bounds();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-50 text-zinc-900">
        <div className="flex min-h-screen">
          <Suspense>
            <Sidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <Suspense>
              <MobileNav />
            </Suspense>
            <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white/90 px-4 py-2 backdrop-blur md:px-6">
              <div className="text-xs text-zinc-500">
                Snapshot = everything known by <span className="font-medium text-zinc-700">end of the selected day (IST)</span>. Later outcomes never leak in.
              </div>
              {b && (
                <Suspense>
                  <AsOfPicker bounds={b} />
                </Suspense>
              )}
            </header>
            <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 md:px-6">
              {dbError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  <div className="font-semibold">Database unavailable</div>
                  <div className="mt-1">{dbError}</div>
                </div>
              ) : (
                children
              )}
            </main>
          </div>
          <Suspense>
            <AiPanel />
          </Suspense>
        </div>
      </body>
    </html>
  );
}
