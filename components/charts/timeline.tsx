"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Filters } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import type { WeekCount } from "@/lib/queries/dashboard";
import { useFilterNav } from "../filters/use-filter-nav";

const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const tick = (iso: string) => short.format(new Date(`${iso}T00:00:00Z`));

/** Defections per week; selecting a bar lists that week's events below. */
export function Timeline({ weeks, filters }: { weeks: WeekCount[]; filters: Filters }) {
  const { go, pending } = useFilterNav(filters);
  const select = (week: string) => go({ week: filters.week === week ? undefined : week });

  return (
    <div className="h-64 w-full" aria-busy={pending} role="img" aria-label="Defections per week: see the table below for the numbers">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} className="stroke-border" />
          <XAxis dataKey="week_start" tickFormatter={tick} tickLine={false} axisLine={false} minTickGap={24} className="text-xs" tick={{ fill: "var(--muted-foreground)" }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} className="text-xs" tick={{ fill: "var(--muted-foreground)" }} />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            labelFormatter={(label) => `Week of ${formatDate(String(label))}`}
            formatter={(value) => [String(value), "Defections"]}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
          />
          <Bar dataKey="defections" radius={[4, 4, 0, 0]} onClick={(entry) => select(String((entry as { week_start?: string }).week_start ?? ""))} className="cursor-pointer">
            {weeks.map((w) => (
              <Cell
                key={w.week_start}
                className={filters.week === w.week_start ? "fill-highlight" : filters.week ? "fill-chart-3" : "fill-primary"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
