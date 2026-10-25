import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminEmpty, AdminGate, AdminPage } from "@/components/admin/admin-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { getRuns } from "@/lib/queries/admin";
import { runDuration } from "@/lib/review";

export const metadata: Metadata = { title: "Agent runs" };

export default function RunsPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy aria-label="Loading agent runs" />}>
      <AdminGate path="/admin/runs">
        <Runs />
      </AdminGate>
    </Suspense>
  );
}

const time = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

async function Runs() {
  const runs = await getRuns();
  return (
    <AdminPage
      title="Agent runs"
      description="The last 50 runs of the detection agent (every 15 minutes on GitHub Actions). Times are in WAT. The full log of each run is on its GitHub Actions page."
    >
      {runs.length === 0 ? (
        <AdminEmpty>No runs recorded yet. Runs appear once the scheduled workflow (or npm run agent) has run against this database.</AdminEmpty>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Feeds</TableHead>
                <TableHead className="text-right">Articles</TableHead>
                <TableHead className="text-right">LLM calls</TableHead>
                <TableHead className="text-right">Tokens in / out</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead>Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap">
                    {time.format(new Date(r.started_at))}
                    <span className="block text-xs text-muted-foreground">#{r.id}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{runDuration(r)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.feeds_ok}
                    {r.feeds_failed ? <span className="text-destructive"> / {r.feeds_failed} failed</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.articles_new)}
                    <span className="block text-xs text-muted-foreground">{r.articles_prefiltered} passed filter</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.llm_calls}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {formatNumber(r.input_tokens)} / {formatNumber(r.output_tokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.events_created}
                    <span className="block text-xs text-muted-foreground">{r.events_published} published</span>
                  </TableCell>
                  <TableCell className="max-w-sm">
                    {r.errors.length ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-destructive">{r.errors.length} error{r.errors.length === 1 ? "" : "s"}</summary>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          {r.errors.slice(0, 20).map((e, i) => (
                            <li key={i} className="break-words">
                              <span className="font-mono">{e.where}</span>: {e.message}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminPage>
  );
}
