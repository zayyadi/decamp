import { ArrowRightIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PartyBadge, StatusBadge } from "@/components/badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { chamberShort, formatDate, formatNumber, formatSigned } from "@/lib/format";
import type { Alert, DashboardEvent, Kpis } from "@/lib/queries/dashboard";

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

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function relativeTime(iso: string, now: number): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  return Math.abs(days) < 30 ? rtf.format(days, "day") : formatDate(iso);
}

export function AlertFeed({ alerts, now }: { alerts: Alert[]; now: number }) {
  if (alerts.length === 0) return <p className="text-sm text-muted-foreground">No alerts yet.</p>;
  return (
    <ol className="divide-y">
      {alerts.map((a) => {
        // Unverified events aren't public, so only confirmed alerts link through.
        const href = a.level === "confirmed" && a.event_id ? `/events/${a.event_id}` : null;
        return (
          <li key={a.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge level={a.level} />
              <time dateTime={a.created_at} className="text-xs text-muted-foreground">
                {relativeTime(a.created_at, now)}
              </time>
            </div>
            <p className="text-sm leading-snug font-medium">
              {href ? (
                <Link href={href} className="hover:text-primary hover:underline">
                  {a.title}
                </Link>
              ) : (
                a.title
              )}
            </p>
            <p className="text-xs text-muted-foreground">{a.body}</p>
          </li>
        );
      })}
    </ol>
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
