"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { addDays, type Filters } from "@/lib/filters";
import { formatDate, formatNumber } from "@/lib/format";
import { partyColor } from "@/lib/parties";
import type { Strength } from "@/lib/queries/dashboard";
import { useFilterNav } from "../filters/use-filter-nav";

interface Row {
  label: string;
  parties: Strength[];
}

const DAY = 86_400_000;
const dayIndex = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * One 100% bar per chamber, built from divs rather than Recharts: the seat
 * shares read better as a parliament strip, and each segment is labelled.
 */
export function PartyStrength({
  rows,
  asOf,
  minDate,
  today,
  filters,
}: {
  rows: Row[];
  asOf: string;
  minDate: string;
  today: string;
  filters: Filters;
}) {
  const { go, pending } = useFilterNav(filters);
  const max = dayIndex(minDate, today);
  const [draft, setDraft] = useState(dayIndex(minDate, asOf));
  const draftDate = addDays(minDate, draft);

  return (
    <div className="space-y-6" aria-busy={pending}>
      {rows.map(({ label, parties }) => {
        const total = parties.reduce((sum, p) => sum + p.seats, 0);
        return (
          <div key={label} className="space-y-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">{label}</span>
              <span className="text-muted-foreground">{formatNumber(total)} seats counted</span>
            </div>
            {total === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">No seats on record for this date.</p>
            ) : (
              <>
                <div className="flex h-9 w-full overflow-hidden rounded-lg ring-1 ring-border" aria-hidden>
                  {parties.map((p) => (
                    <div
                      key={p.code}
                      title={`${p.code}: ${p.seats} seats`}
                      className="flex min-w-0 items-center justify-center border-r border-background/70 text-xs font-semibold text-white last:border-r-0"
                      style={{ width: `${(100 * p.seats) / total}%`, backgroundColor: partyColor(p.code, p.color) }}
                    >
                      {p.seats / total >= 0.07 ? p.code : null}
                    </div>
                  ))}
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {parties.map((p) => (
                    <li key={p.code} className="flex items-center gap-1.5">
                      <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: partyColor(p.code, p.color) }} />
                      <span className="font-semibold text-foreground">{p.code}</span> {p.seats}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })}

      <div className="space-y-2 rounded-xl bg-muted p-3">
        <div className="flex items-baseline justify-between text-sm">
          <span id="as-of-label" className="font-medium">
            As of <span className="font-semibold text-primary">{formatDate(draftDate)}</span>
          </span>
          {asOf !== today ? (
            <button type="button" className="text-xs font-medium text-highlight underline-offset-2 hover:underline" onClick={() => go({ asOf: undefined })}>
              Back to today
            </button>
          ) : null}
        </div>
        <Slider
          aria-labelledby="as-of-label"
          min={0}
          max={max}
          step={1}
          value={[draft]}
          onValueChange={(v) => setDraft(Array.isArray(v) ? v[0] : v)}
          onValueCommitted={(v) => {
            const date = addDays(minDate, Array.isArray(v) ? v[0] : v);
            go({ asOf: date === today ? undefined : date });
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatDate(minDate)}</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}
