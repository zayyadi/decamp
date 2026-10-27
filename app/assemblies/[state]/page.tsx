import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PartyBadge } from "@/components/badges";
import { EventsTable, KpiCards } from "@/components/overview-parts";
import { EmptyState, PageHeading, SectionCard } from "@/components/section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getEvents, getKpis, getReference } from "@/lib/queries/dashboard";
import { listAssemblyMembers } from "@/lib/queries/legislators";

export async function generateMetadata({ params }: PageProps<"/assemblies/[state]">): Promise<Metadata> {
  const { state } = await params;
  return { title: `${decodeURIComponent(state)} State House of Assembly` };
}

export default function AssemblyState({ params }: PageProps<"/assemblies/[state]">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/assemblies" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" aria-hidden /> All state assemblies
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy aria-label="Loading the assembly" />}>
        <StateAssembly params={params} />
      </Suspense>
    </main>
  );
}

async function StateAssembly({ params }: { params: PageProps<"/assemblies/[state]">["params"] }) {
  const state = decodeURIComponent((await params).state);
  const reference = await getReference();
  // Only real assemblies: the FCT has Area Councils instead.
  if (state === "FCT" || !reference.states.some((s) => s.name === state)) notFound();

  const scoped = { chamber: "state_assembly" as const, state };
  const [kpis, events, members] = await Promise.all([getKpis(scoped), getEvents(scoped, 100), listAssemblyMembers(state)]);

  return (
    <>
      <PageHeading eyebrow="State House of Assembly" title={<>{state} <span className="text-highlight italic">Assembly</span></>}>
        Confirmed party defections by members of the {state} State House of Assembly since June 2023.
      </PageHeading>
      <KpiCards kpis={kpis} rangeLabel="Since June 2023" />

      <SectionCard title="Defections" description="Newest first. Each links to its sources.">
        {events.length ? <EventsTable events={events} /> : <EmptyState>No confirmed defections in the {state} assembly yet.</EmptyState>}
      </SectionCard>

      <SectionCard
        title="Members on record"
        description="Members join the record as their defections are confirmed, so this is not the full assembly and gives no seat totals."
      >
        {members.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>State constituency</TableHead>
                <TableHead>Current party</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link href={`/legislators/${m.id}`} className="font-medium hover:text-primary hover:underline">
                      {m.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>{m.constituency}</TableCell>
                  <TableCell>
                    <PartyBadge code={m.current_party.code} color={m.current_party.color} name={m.current_party.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState>No {state} assembly members are on record yet.</EmptyState>
        )}
      </SectionCard>
    </>
  );
}
