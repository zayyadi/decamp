import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PartyFlows } from "@/components/charts/party-flows";
import { Timeline } from "@/components/charts/timeline";
import { OverviewFilters } from "@/components/filters/overview-filters";
import { StateMap } from "@/components/map/state-map";
import { EventsTable, KpiCards } from "@/components/overview-parts";
import { EmptyState, PageHeading, SectionCard } from "@/components/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, parseFilters, toQuery, type Filters } from "@/lib/filters";
import { formatDate } from "@/lib/format";
import { getByState, getByWeek, getEvents, getFlows, getKpis, getReference, type ScopedFilters } from "@/lib/queries/dashboard";

export const metadata: Metadata = {
  title: "State Houses of Assembly",
  description: "Confirmed party defections by members of Nigeria's 36 State Houses of Assembly.",
};

export default function Assemblies({ searchParams }: PageProps<"/assemblies">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading eyebrow="State Houses of Assembly" title={<>Defections in the <span className="text-highlight italic">states</span></>}>
        Confirmed party defections by members of the 36 State Houses of Assembly, kept apart from the National Assembly
        counts.
      </PageHeading>
      <p role="note" className="rounded-2xl border border-unverified-border bg-unverified p-4 text-sm text-unverified-foreground">
        <strong>Coverage is growing.</strong> Assembly rosters are added as editors confirm each defection, so this page
        shows confirmed defections, not seat totals. Every state-assembly report is checked by an editor before it appears.
      </p>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy aria-label="Loading state assemblies" />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function rangeLabel(f: Filters): string {
  if (f.from && f.to) return `${formatDate(f.from)} – ${formatDate(f.to)}`;
  if (f.from) return `Since ${formatDate(f.from)}`;
  if (f.to) return `Up to ${formatDate(f.to)}`;
  return "Since June 2023";
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/assemblies">["searchParams"] }) {
  // One chamber here: a chamber in the URL (from the national page) is ignored.
  const filters: Filters = { ...parseFilters(await searchParams), chamber: undefined };
  const scoped: ScopedFilters = { ...filters, chamber: "state_assembly" };
  const [reference, kpis, flows, states, weeks, events] = await Promise.all([
    getReference(),
    getKpis(scoped),
    getFlows(scoped),
    getByState(scoped),
    getByWeek(scoped),
    getEvents(filters.week ? { ...scoped, from: filters.week, to: addDays(filters.week, 6) } : scoped, filters.week ? 100 : 20),
  ]);
  // The FCT has Area Councils, not a House of Assembly.
  const assemblyStates = reference.states.filter((s) => s.name !== "FCT");

  return (
    <div className="flex flex-col gap-6">
      <OverviewFilters filters={filters} reference={{ ...reference, states: assemblyStates }} chambers={false} />
      <KpiCards kpis={kpis} rangeLabel={rangeLabel(filters)} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="By state"
          description="Darker states saw more confirmed assembly defections. Select one to filter; open a state for its members."
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Defections</TableHead>
                  <TableHead>Most common move</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assemblyStates.map((s) => {
                  const c = states.find((x) => x.state === s.name);
                  return (
                    <TableRow key={s.name}>
                      <TableCell>
                        <Link href={`/assemblies/${encodeURIComponent(s.name)}`} className="hover:underline">
                          {s.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c?.defections ?? 0}</TableCell>
                      <TableCell>{c?.top_from ? `${c.top_from} → ${c.top_to} (${c.top_count})` : "–"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          }
        >
          <StateMap counts={states} filters={filters} />
        </SectionCard>

        <SectionCard
          title="Party flows"
          description={`Where assembly members went, ${rangeLabel(filters).toLowerCase()}.`}
          table={
            flows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Defections</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flows.map((f) => (
                    <TableRow key={`${f.from_code}-${f.to_code}`}>
                      <TableCell>{f.from_code}</TableCell>
                      <TableCell>{f.to_code}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.defections}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : undefined
          }
        >
          {flows.length ? <PartyFlows flows={flows} /> : <EmptyState>No confirmed state-assembly defections match these filters yet.</EmptyState>}
        </SectionCard>
      </div>

      <SectionCard
        title="Timeline"
        description="Confirmed state-assembly defections per week. Select a week to list its defections."
        table={
          weeks.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week of</TableHead>
                  <TableHead className="text-right">Defections</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map((w) => (
                  <TableRow key={w.week_start}>
                    <TableCell>{formatDate(w.week_start)}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.defections}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : undefined
        }
      >
        {weeks.length ? <Timeline weeks={weeks} filters={filters} /> : <EmptyState>No confirmed state-assembly defections match these filters yet.</EmptyState>}
      </SectionCard>

      <SectionCard
        title={filters.week ? `Week of ${formatDate(filters.week)}` : "Recent defections"}
        description={filters.week ? `${events.length} confirmed defection${events.length === 1 ? "" : "s"}.` : "The latest confirmed state-assembly defections in this view."}
        actions={
          filters.week ? (
            <Link href={`/assemblies${toQuery(filters, { week: undefined })}`} scroll={false} className="text-sm font-semibold text-highlight hover:underline">
              Show recent instead
            </Link>
          ) : null
        }
      >
        {events.length ? <EventsTable events={events} /> : <EmptyState>No confirmed state-assembly defections match these filters yet.</EmptyState>}
      </SectionCard>
    </div>
  );
}
