"use client";

import { LoaderCircleIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Filters } from "@/lib/filters";
import type { Reference } from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";
import { useFilterNav } from "./use-filter-nav";

const CHAMBERS = [
  { value: undefined, label: "Both chambers" },
  { value: "senate", label: "Senate" },
  { value: "house", label: "House" },
] as const;

export function OverviewFilters({ filters, reference }: { filters: Filters; reference: Reference }) {
  const { go, pending } = useFilterNav(filters);
  const active = Boolean(filters.chamber || filters.party || filters.state || filters.from || filters.to || filters.week);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-muted p-3 lg:flex-row lg:items-end lg:justify-between">
      <div role="radiogroup" aria-label="Chamber" className="flex w-fit items-center gap-1 rounded-full border border-accent bg-card p-1">
        {CHAMBERS.map(({ value, label }) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={filters.chamber === value}
            onClick={() => go({ chamber: value, week: undefined })}
            className={cn(
              "rounded-full px-4 whitespace-nowrap py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              "aria-checked:bg-primary aria-checked:text-primary-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Party (from or to)
          <NativeSelect value={filters.party ?? ""} onChange={(e) => go({ party: e.target.value || undefined, week: undefined })}>
            <NativeSelectOption value="">All parties</NativeSelectOption>
            {reference.parties.map((p) => (
              <NativeSelectOption key={p.code} value={p.code}>
                {p.code} · {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          State
          <NativeSelect value={filters.state ?? ""} onChange={(e) => go({ state: e.target.value || undefined, week: undefined })}>
            <NativeSelectOption value="">All states</NativeSelectOption>
            {reference.states.map((s) => (
              <NativeSelectOption key={s.name} value={s.name}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          From
          <Input
            type="date"
            className="w-38 bg-card"
            defaultValue={filters.from}
            key={`from-${filters.from}`}
            onBlur={(e) => e.target.value !== (filters.from ?? "") && go({ from: e.target.value || undefined, week: undefined })}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          To
          <Input
            type="date"
            className="w-38 bg-card"
            defaultValue={filters.to}
            key={`to-${filters.to}`}
            onBlur={(e) => e.target.value !== (filters.to ?? "") && go({ to: e.target.value || undefined, week: undefined })}
          />
        </label>
        {active ? (
          <Button
            variant="ghost"
            onClick={() =>
              go({ chamber: undefined, party: undefined, state: undefined, from: undefined, to: undefined, week: undefined })
            }
          >
            <XIcon aria-hidden /> Clear
          </Button>
        ) : null}
        <span aria-live="polite" className="flex h-8 w-5 items-center">
          {pending ? <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" aria-label="Updating" /> : null}
        </span>
      </div>
    </div>
  );
}
