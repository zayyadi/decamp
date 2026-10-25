"use client";

import { useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { Filters } from "@/lib/filters";
import { formatNumber } from "@/lib/format";
import type { StateCount } from "@/lib/queries/dashboard";
import { useFilterNav } from "../filters/use-filter-nav";

// Built by scripts/build-map.ts from geoBoundaries (GRID3, 2022, CC BY 4.0).
const MAP_URL = "/maps/ng-states.topo.json";

/** Share of the primary colour for a count; empty states keep the muted fill. */
export function shade(count: number, max: number): number {
  return count === 0 || max === 0 ? 0 : Math.round(25 + (75 * count) / max);
}

const fillFor = (pct: number) =>
  pct === 0 ? "var(--muted)" : `color-mix(in oklab, var(--primary) ${pct}%, var(--muted))`;

export function StateMap({ counts, filters }: { counts: StateCount[]; filters: Filters }) {
  const { go, pending } = useFilterNav(filters);
  const [focus, setFocus] = useState<string | null>(null);
  const byState = new Map(counts.map((c) => [c.state, c]));
  const max = Math.max(0, ...counts.map((c) => c.defections));
  const shown = focus ?? filters.state ?? null;
  const info = shown ? byState.get(shown) : undefined;

  const toggle = (name: string) => go({ state: filters.state === name ? undefined : name, week: undefined });

  return (
    <div className="space-y-3" aria-busy={pending}>
      <p aria-live="polite" className="min-h-10 rounded-lg bg-muted px-3 py-2 text-sm">
        {shown ? (
          <>
            <span className="font-semibold">{shown}</span>: {formatNumber(info?.defections ?? 0)} defection
            {info?.defections === 1 ? "" : "s"}
            {info?.top_from ? (
              <span className="text-muted-foreground">
                {" "}
                · most common move {info.top_from} → {info.top_to} ({info.top_count})
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">Hover or focus a state for details; select it to filter the page.</span>
        )}
      </p>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [8.68, 9.1], scale: 2300 }}
        width={560}
        height={480}
        className="h-auto w-full"
        role="group"
        aria-label="Map of defections by state"
      >
        <Geographies geography={MAP_URL}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const name = String(geo.properties?.name ?? "");
              const count = byState.get(name)?.defections ?? 0;
              const selected = filters.state === name;
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  tabIndex={0}
                  role="button"
                  aria-pressed={selected}
                  aria-label={`${name}: ${count} defection${count === 1 ? "" : "s"}${selected ? ", selected" : ""}`}
                  onMouseEnter={() => setFocus(name)}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus(name)}
                  onBlur={() => setFocus(null)}
                  onClick={() => toggle(name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(name);
                    }
                  }}
                  className="cursor-pointer stroke-background stroke-[0.75] outline-none transition-[filter] hover:brightness-110 focus-visible:stroke-ring focus-visible:stroke-2 aria-pressed:stroke-highlight aria-pressed:stroke-2"
                  style={{ fill: fillFor(shade(count, max)) }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
        <span>0</span>
        <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(to right, var(--muted), ${fillFor(25)}, ${fillFor(100)})` }} />
        <span>{formatNumber(max)}</span>
      </div>
    </div>
  );
}
