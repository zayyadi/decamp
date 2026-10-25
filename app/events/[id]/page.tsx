import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FictionalBadge, PartyBadge, StatusBadge } from "@/components/badges";
import { SectionCard } from "@/components/section-card";
import { chamberLabel, formatConfidence, formatDate, honorific } from "@/lib/format";
import { getEvent, type EventAlert } from "@/lib/queries/events";

export const metadata: Metadata = { title: "Defection" };

// Quotes are stored verbatim and may already carry their own quotation marks.
const unquote = (text: string) => text.replace(/^["\u201c\u201d]+|["\u201c\u201d]+$/g, "");

export default function EventPage({ params }: PageProps<"/events/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" aria-hidden /> Overview
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy aria-label="Loading the event" />}>
        <EventDetail params={params} />
      </Suspense>
    </main>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function History({ alerts }: { alerts: EventAlert[] }) {
  return (
    <ol className="space-y-3">
      {alerts.map((a) => (
        <li key={a.id} className="flex flex-col gap-1 rounded-xl border bg-muted/60 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            {a.kind === "correction" ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-highlight">
                <TriangleAlertIcon className="size-3.5" aria-hidden /> Correction
              </span>
            ) : (
              <StatusBadge level={a.level} />
            )}
            <time dateTime={a.created_at} className="text-xs text-muted-foreground">
              {formatDate(a.created_at)}
            </time>
          </div>
          <p className="font-medium">{a.title}</p>
          <p className="text-muted-foreground">{a.body}</p>
        </li>
      ))}
    </ol>
  );
}

async function EventDetail({ params }: { params: PageProps<"/events/[id]">["params"] }) {
  const { id } = await params;
  const page = await getEvent(id);
  if (!page) notFound();
  const { event: e, alerts } = page;

  if (!e) {
    // Withdrawn (reversed) or not yet public; only the alerts are visible.
    const corrected = alerts.some((a) => a.kind === "correction");
    return (
      <SectionCard
        title={corrected ? "This report was withdrawn" : "This report is not public"}
        description={corrected ? "We published this defection and later corrected it. Party counts were restored." : "It is still under review, so party counts are unchanged."}
      >
        <History alerts={alerts} />
      </SectionCard>
    );
  }

  const l = e.legislator;
  const verb = e.is_return ? "returns to" : "defects to";
  return (
    <>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge level="confirmed" />
          {l.is_fictional ? <FictionalBadge /> : null}
        </div>
        <h1 className="font-heading text-4xl leading-tight font-bold tracking-tight text-balance">
          <Link href={`/legislators/${l.id}`} className="hover:text-primary">
            {honorific(l.chamber)} {l.full_name}
          </Link>{" "}
          {verb} <span className="text-highlight">{e.to_party.code}</span>
        </h1>
        <p className="text-muted-foreground">
          {chamberLabel(l.chamber)} · {l.constituency}, {l.state}
        </p>
        <div className="flex items-center gap-3 rounded-2xl border bg-muted p-4">
          <PartyBadge code={e.from_party?.code ?? null} color={e.from_party?.color} name={e.from_party?.name} className="px-3 py-1 text-sm" />
          <ArrowRightIcon className="size-5 text-highlight" aria-label="to" />
          <PartyBadge code={e.to_party.code} color={e.to_party.color} name={e.to_party.name} className="px-3 py-1 text-sm" />
          <span className="ml-auto hidden text-sm text-muted-foreground sm:inline">
            {e.from_party?.name ?? "Unknown party"} → {e.to_party.name}
          </span>
        </div>
      </section>

      <SectionCard title="What happened">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Defection date">{formatDate(e.event_date)}</Fact>
          <Fact label="Announced in plenary">{formatDate(e.announced_date)}</Fact>
          <Fact label="Confidence">
            {e.model === "historical-import" ? "Sourced historical record" : <>
              {formatConfidence(e.confidence)} <span className="text-sm font-normal text-muted-foreground">(confirmed at 85% or by an editor)</span>
            </>}
          </Fact>
        </dl>
        <blockquote className="mt-5 border-l-4 border-primary pl-4 font-heading text-lg leading-relaxed italic">{e.evidence_quote}</blockquote>
        {e.reason_given ? <p className="mt-4 text-sm"><span className="font-medium">Reason given:</span> {e.reason_given}</p> : null}
      </SectionCard>

      <SectionCard title="Sources" description="We link to the reporting rather than reproduce it.">
        {e.sources.length ? (
          <ul className="space-y-3">
            {e.sources.map((s) => (
              <li key={s.article.id} className="rounded-xl border p-3">
                <a href={s.article.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 font-medium hover:text-primary hover:underline">
                  {s.article.title}
                  <ExternalLinkIcon className="mt-1 size-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.article.outlet} · {formatDate(s.article.published_at)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">&ldquo;{unquote(s.evidence_quote)}&rdquo;</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No source articles are linked to this event.</p>
        )}
      </SectionCard>

      {alerts.length ? (
        <SectionCard title="History" description="Alerts and corrections for this event.">
          <History alerts={alerts} />
        </SectionCard>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {e.model === "historical-import" ? "Imported from historical source research" : <>Detected by {e.model ?? "unknown model"} with prompt {e.prompt_version ?? "unknown"}</>} · recorded {formatDate(e.created_at)}
        {e.reasoning_summary ? <> · {e.reasoning_summary}</> : null}
      </p>
    </>
  );
}
