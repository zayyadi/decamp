import { ArrowRightIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PartyBadge } from "@/components/badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { chamberShort, formatDate, formatNumber, formatSigned } from "@/lib/format";
import type { DashboardEvent, Kpis } from "@/lib/queries/dashboard";

function Kpi({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      <div className="font-heading text-4xl leading-none font-bold tracking-tight">{value}</div>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function KpiCards({ kpis, rangeLabel }: { kpis: Kpis; rangeLabel: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Confirmed defections" value={formatNumber(kpis.total)} detail={rangeLabel} />
      <Kpi label="In the last 7 days" value={formatNumber(kpis.last_7_days)} detail="Other filters still apply" />
      <Kpi
        label="Biggest net gainer"
        icon={<TrendingUpIcon className="size-4 text-confirmed" aria-hidden />}
        value={kpis.top_gainer ? <PartyBadge code={kpis.top_gainer} className="px-3 py-1 font-sans text-2xl" /> : "–"}
        detail={kpis.top_gainer ? `${formatSigned(kpis.top_gainer_net ?? 0)} members` : "No net gains in this view"}
      />
      <Kpi
        label="Biggest net loser"
        icon={<TrendingDownIcon className="size-4 text-highlight" aria-hidden />}
        value={kpis.top_loser ? <PartyBadge code={kpis.top_loser} className="px-3 py-1 font-sans text-2xl" /> : "–"}
        detail={kpis.top_loser ? `${formatSigned(kpis.top_loser_net ?? 0)} members` : "No net losses in this view"}
      />
    </div>
  );
}

export function EventsTable({ events }: { events: DashboardEvent[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Member</TableHead>
          <TableHead className="hidden md:table-cell">Chamber</TableHead>
          <TableHead className="hidden sm:table-cell">State</TableHead>
          <TableHead>Move</TableHead>
          <TableHead>
            <span className="sr-only">Details</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="whitespace-nowrap">{formatDate(e.effective_date)}</TableCell>
            <TableCell>
              <Link href={`/legislators/${e.legislator_id}`} className="font-medium hover:text-primary hover:underline">
                {e.full_name}
              </Link>
            </TableCell>
            <TableCell className="hidden md:table-cell">{chamberShort(e.chamber)}</TableCell>
            <TableCell className="hidden sm:table-cell">{e.state}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5">
                <PartyBadge code={e.from_code} />
                <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-label="to" />
                <PartyBadge code={e.to_code} />
              </span>
            </TableCell>
            <TableCell className="text-right">
              <Link href={`/events/${e.id}`} className="text-xs font-semibold text-highlight hover:underline">
                Details
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
