import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PartyBadge } from "@/components/badges";
import { EmptyState, PageHeading } from "@/components/section-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseLegislatorQuery, toQuery, type LegislatorQuery, type Sort } from "@/lib/filters";
import { chamberShort, formatNumber } from "@/lib/format";
import { getReference } from "@/lib/queries/dashboard";
import { listLegislators } from "@/lib/queries/legislators";

export const metadata: Metadata = { title: "Legislators" };

export default function Legislators({ searchParams }: PageProps<"/legislators">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeading eyebrow="The roster" title={<>Every sitting <span className="text-highlight italic">member</span></>}>
        Search the Senate and House of Representatives. Party is the member&apos;s current party on our records.
      </PageHeading>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy aria-label="Loading legislators" />}>
        <Roster searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const COLUMNS: { sort: Sort; label: string; className?: string }[] = [
  { sort: "name", label: "Name" },
  { sort: "chamber", label: "Chamber", className: "hidden md:table-cell" },
  { sort: "state", label: "State" },
  { sort: "party", label: "Party" },
];

function SortHeader({ query, sort, label, className }: { query: LegislatorQuery; sort: Sort; label: string; className?: string }) {
  const active = query.sort === sort;
  const next = active && query.dir === "asc" ? "desc" : "asc";
  const Icon = query.dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead className={className} aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={`/legislators${toQuery(query, { sort, dir: next })}`} scroll={false} className="inline-flex items-center gap-1 hover:text-primary">
        {label}
        {active ? <Icon className="size-3.5" aria-hidden /> : null}
      </Link>
    </TableHead>
  );
}

async function Roster({ searchParams }: { searchParams: PageProps<"/legislators">["searchParams"] }) {
  const query = parseLegislatorQuery(await searchParams);
  const [reference, rows] = await Promise.all([getReference(), listLegislators(query)]);
  const filtered = Boolean(query.q || query.chamber || query.party || query.state);

  return (
    <div className="flex flex-col gap-4">
      {/* A plain GET form: filtering works without JavaScript and keeps everything in the URL. */}
      <form action="/legislators" className="flex flex-col gap-3 rounded-2xl border bg-muted p-3 md:flex-row md:items-end">
        <label className="grid flex-1 gap-1 text-xs font-medium text-muted-foreground">
          Name
          <span className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
            <Input name="q" type="search" defaultValue={query.q} placeholder="Search by name" className="bg-card pl-8" />
          </span>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Chamber
          <NativeSelect name="chamber" defaultValue={query.chamber ?? ""}>
            <NativeSelectOption value="">Both</NativeSelectOption>
            <NativeSelectOption value="senate">Senate</NativeSelectOption>
            <NativeSelectOption value="house">House</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Party
          <NativeSelect name="party" defaultValue={query.party ?? ""}>
            <NativeSelectOption value="">All parties</NativeSelectOption>
            {reference.parties.map((p) => (
              <NativeSelectOption key={p.code} value={p.code}>
                {p.code}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          State
          <NativeSelect name="state" defaultValue={query.state ?? ""}>
            <NativeSelectOption value="">All states</NativeSelectOption>
            {reference.states.map((s) => (
              <NativeSelectOption key={s.name} value={s.name}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {query.sort !== "name" ? <input type="hidden" name="sort" value={query.sort} /> : null}
        {query.dir !== "asc" ? <input type="hidden" name="dir" value={query.dir} /> : null}
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          {filtered ? (
            <Link href="/legislators" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {formatNumber(rows.length)} member{rows.length === 1 ? "" : "s"}
        {filtered ? " match" : ""}
      </p>

      {rows.length === 0 ? (
        <EmptyState>No sitting members match. Try a shorter name or clear a filter.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c) => (
                  <SortHeader key={c.sort} query={query} {...c} />
                ))}
                <TableHead className="hidden lg:table-cell">Constituency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/legislators/${r.id}`} className="font-medium hover:text-primary hover:underline">
                      {r.full_name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{chamberShort(r.chamber)}</TableCell>
                  <TableCell>{r.state}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <PartyBadge code={r.current_party.code} color={r.current_party.color} name={r.current_party.name} />
                      {r.elected_party.code !== r.current_party.code ? (
                        <span className="text-xs text-muted-foreground">elected {r.elected_party.code}</span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{r.constituency}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
