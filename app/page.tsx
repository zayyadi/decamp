import Link from "next/link";
import { Suspense } from "react";
import { PartyFlows } from "@/components/charts/party-flows";
import { PartyStrength } from "@/components/charts/party-strength";
import { Timeline } from "@/components/charts/timeline";
import { OverviewFilters } from "@/components/filters/overview-filters";
import { StateMap } from "@/components/map/state-map";
import { LiveAlertFeed, LiveStatusBadge } from "@/components/alerts/live-alert-feed";
import { EventsTable, KpiCards } from "@/components/overview-parts";
import { EmptyState, PageHeading, SectionCard } from "@/components/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, parseFilters, toQuery, type Filters } from "@/lib/filters";
import { requestClock } from "@/lib/clock";
import { formatDate } from "@/lib/format";
import {
  getByState,
  getByWeek,
  getEvents,
  getFlows,
  getKpis,
  getRecentAlerts,
  getReference,
  getStrength,
} from "@/lib/queries/dashboard";

// The 10th National Assembly was inaugurated on 13 June 2023; party strength
// can't be shown for earlier dates.
const TERM_START = "2023-06-13";

export default function Overview({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading eyebrow="10th National Assembly" title={<>Who is <span className="text-highlight italic">decamping</span>, and to where</>}>
        Party defections by sitting senators and representatives, tracked from the news. Counts change only when a
        defection is confirmed.
      </PageHeading>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function rangeLabel(f: Filters): string {
  if (f.from && f.to) return `${formatDate(f.from)} – ${formatDate(f.to)}`;
  if (f.from) return `Since ${formatDate(f.from)}`;
  if (f.to) return `Up to ${formatDate(f.to)}`;
  return "Since the start of the term";
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const filters = parseFilters(await searchParams);
  const { now, today } = await requestClock();
  const asOf = filters.asOf && filters.asOf >= TERM_START && filters.asOf <= today ? filters.asOf : today;
  const weekFilters = filters.week ? { ...filters, from: filters.week, to: addDays(filters.week, 6) } : filters;

  const [reference, kpis, flows, states, weeks, senate, house, alerts, events] = await Promise.all([
    getReference(),
    getKpis(filters),
    getFlows(filters),
    getByState(filters),
    getByWeek(filters),
    getStrength("senate", asOf),
    getStrength("house", asOf),
    getRecentAlerts(20),
    getEvents(weekFilters, filters.week ? 100 : 12),
  ]);
  const strengthRows = [
    { label: "Senate", parties: senate, show: filters.chamber !== "house" },
    { label: "House of Representatives", parties: house, show: filters.chamber !== "senate" },
  ].filter((r) => r.show);

  return (
    <div className="flex flex-col gap-6">
      <OverviewFilters filters={filters} reference={reference} />
      <KpiCards kpis={kpis} rangeLabel={rangeLabel(filters)} />

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <SectionCard
            title="Party strength"
            description="Seats per party among members in the database. A partial roster does not represent full chamber totals. Drag to see any date."
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chamber</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Seats on {formatDate(asOf)}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {strengthRows.flatMap((r) =>
                    r.parties.map((p) => (
                      <TableRow key={`${r.label}-${p.code}`}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell>
                          {p.code} · {p.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.seats}</TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            }
          >
            <PartyStrength key={asOf} rows={strengthRows} asOf={asOf} minDate={TERM_START} today={today} filters={filters} />
          </SectionCard>


          <SectionCard
            title="Party flows"
            description={`Where members went, ${rangeLabel(filters).toLowerCase()}.`}
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
            {flows.length ? <PartyFlows flows={flows} /> : <EmptyState>No confirmed defections match these filters.</EmptyState>}
          </SectionCard>
        </div>

        <SectionCard
          title="Latest alerts"
          description="Newest first. Unverified reports never change the counts."
          actions={<LiveStatusBadge />}
          className="scroll-mt-20 lg:sticky lg:top-20"
          id="alerts"
        >
          <div className="-mr-2 overflow-y-auto pr-2 lg:max-h-[calc(100vh-14rem)]">
            <LiveAlertFeed initial={alerts} now={now} />
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="By state"
          description="Darker states saw more defections. Select one to filter the page."
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
                {reference.states.map((s) => {
                  const c = states.find((x) => x.state === s.name);
                  return (
                    <TableRow key={s.name}>
                      <TableCell>
                        <Link href={`/${toQuery(filters, { state: filters.state === s.name ? undefined : s.name, week: undefined })}`} scroll={false} className="hover:underline">
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
          title="Timeline"
          description="Confirmed defections per week. Select a week to list its events."
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
                      <TableCell>
                        <Link href={`/${toQuery(filters, { week: filters.week === w.week_start ? undefined : w.week_start })}`} scroll={false} className="hover:underline">
                          {formatDate(w.week_start)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{w.defections}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : undefined
          }
        >
          {weeks.length ? <Timeline weeks={weeks} filters={filters} /> : <EmptyState>No confirmed defections match these filters.</EmptyState>}
        </SectionCard>
      </div>

      <SectionCard
        title={filters.week ? `Week of ${formatDate(filters.week)}` : "Recent defections"}
        description={filters.week ? `${events.length} confirmed defection${events.length === 1 ? "" : "s"}.` : "The latest confirmed defections in this view."}
        actions={
          filters.week ? (
            <Link href={`/${toQuery(filters, { week: undefined })}`} scroll={false} className="text-sm font-semibold text-highlight hover:underline">
              Show recent instead
            </Link>
          ) : null
        }
      >
        {events.length ? <EventsTable events={events} /> : <EmptyState>No confirmed defections match these filters.</EmptyState>}
      </SectionCard>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy aria-label="Loading the dashboard">
      <div className="h-14 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-2xl bg-muted lg:col-span-2" />
        <div className="h-80 animate-pulse rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
