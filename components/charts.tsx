"use client";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, LabelList,
} from "recharts";

const AXIS = { fontSize: 11, fill: "#71717a" };
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtNum = (n: number) => n.toLocaleString("en-IN");
const fmtInr = (n: number) => (Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : Math.abs(n) >= 1e3 ? `₹${Math.round(n / 1e3)}k` : `₹${Math.round(n)}`);

export type SeriesPoint = { period: string; value: number; cumulative: number };

/** Daily bars + cumulative line, with an optional goal reference line. */
export function DailyCumulativeChart({ points, goal, goalLabel, money = false, height = 220, color = "#6366f1" }: { points: SeriesPoint[]; goal?: number | null; goalLabel?: string; money?: boolean; height?: number; color?: string }) {
  const f = money ? fmtInr : fmtNum;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#f4f4f5" vertical={false} />
          <XAxis dataKey="period" tickFormatter={fmtDate} tick={AXIS} minTickGap={28} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} />
          <YAxis yAxisId="d" tick={AXIS} tickFormatter={f} width={48} tickLine={false} axisLine={false} />
          <YAxis yAxisId="c" orientation="right" tick={AXIS} tickFormatter={f} width={52} tickLine={false} axisLine={false} />
          <Tooltip labelFormatter={(l) => fmtDate(String(l))} formatter={(v, n) => [f(Number(v)), n === "value" ? "That day" : "Cumulative"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Bar yAxisId="d" dataKey="value" fill={color} fillOpacity={0.35} radius={[2, 2, 0, 0]} />
          <Line yAxisId="c" dataKey="cumulative" stroke={color} strokeWidth={2} dot={false} />
          {goal ? <ReferenceLine yAxisId="c" y={goal} stroke="#a1a1aa" strokeDasharray="4 4" label={{ value: goalLabel ?? `Goal ${f(goal)}`, position: "insideTopLeft", fontSize: 11, fill: "#71717a" }} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SparkArea({ points, color = "#6366f1", height = 48 }: { points: SeriesPoint[]; color?: string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area dataKey="cumulative" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export type WaterfallStep = { label: string; value: number; kind: "base" | "up" | "down" | "total" };

export function WaterfallChart({ steps, height = 240 }: { steps: WaterfallStep[]; height?: number }) {
  let running = 0;
  const data = steps.map((s) => {
    if (s.kind === "base" || s.kind === "total") {
      running = s.value;
      return { label: s.label, offset: 0, bar: s.value, kind: s.kind, display: s.value };
    }
    const start = running;
    running += s.value;
    return { label: s.label, offset: Math.min(start, running), bar: Math.abs(s.value), kind: s.kind, display: s.value };
  });
  const color = (k: string) => (k === "up" ? "#10b981" : k === "down" ? "#f43f5e" : k === "total" ? "#4f46e5" : "#a5b4fc");
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#f4f4f5" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} interval={0} />
          <YAxis tick={AXIS} width={44} tickFormatter={fmtNum} tickLine={false} axisLine={false} />
          <Tooltip formatter={(_v, _n, item) => [fmtNum((item?.payload as { display: number }).display), "Attendees"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Bar dataKey="offset" stackId="w" fill="transparent" />
          <Bar dataKey="bar" stackId="w" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={color(d.kind)} />
            ))}
            <LabelList dataKey="display" position="top" formatter={(v) => { const n = Number(v); return (n > 0 && data.length ? (n >= 1000 ? fmtNum(n) : `${n > 0 ? "+" : ""}${n}`) : `${n}`); }} style={{ fontSize: 11, fill: "#3f3f46" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HBarChart({ rows, height = 200, money = false }: { rows: { label: string; value: number; color?: string }[]; height?: number; money?: boolean }) {
  const f = money ? fmtInr : fmtNum;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" tick={AXIS} width={130} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => f(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {rows.map((r, i) => (
              <Cell key={i} fill={r.color ?? "#6366f1"} />
            ))}
            <LabelList dataKey="value" position="right" formatter={(v) => f(Number(v))} style={{ fontSize: 11, fill: "#3f3f46" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
