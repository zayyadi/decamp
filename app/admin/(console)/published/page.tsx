import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminEmpty, AdminGate, AdminLink, AdminPage } from "@/components/admin/admin-shell";
import { ReverseForm } from "@/components/admin/reverse-form";
import { FictionalBadge, PartyBadge } from "@/components/badges";
import { chamberShort, formatDate, honorific } from "@/lib/format";
import { getPublished } from "@/lib/queries/admin";

export const metadata: Metadata = { title: "Published" };

export default function PublishedPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy aria-label="Loading published events" />}>
      <AdminGate path="/admin/published">
        <Published />
      </AdminGate>
    </Suspense>
  );
}

async function Published() {
  const events = await getPublished();
  return (
    <AdminPage
      title="Published defections"
      description="Reverse a defection when it turns out to be wrong or is rescinded. Its party change is undone and your note is published as a correction. Only a member's most recent defection can be reversed."
    >
      {events.some((e) => !e.legislator) ? (
        <p role="status" className="rounded-xl border border-unverified-border bg-unverified p-4 text-sm text-unverified-foreground">
          Some linked member records are unavailable to this session. Their events remain listed, but reversal is disabled.
          {" "}If this started after turning demo mode off, apply the pending admin visibility migration in Supabase, then reload.
        </p>
      ) : null}
      {events.length === 0 ? (
        <AdminEmpty>No published defections yet.</AdminEmpty>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {events.map((e) => (
            <li key={e.id} className="grid gap-4 p-4 md:grid-cols-[3fr_2fr]">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {e.legislator ? <AdminLink href={`/events/${e.id}`}>
                    {honorific(e.legislator.chamber)} {e.legislator.full_name}
                  </AdminLink> : <span className="font-medium">{e.raw_name} · member record unavailable</span>}
                  {e.legislator?.is_fictional ? <FictionalBadge /> : null}
                </div>
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <PartyBadge code={e.from_party?.code ?? null} />
                  <ArrowRightIcon className="size-3.5" aria-label="to" />
                  <PartyBadge code={e.to_party.code} />
                  <span>
                    {e.legislator ? <>· {chamberShort(e.legislator.chamber)}, {e.legislator.state} </> : null}· {formatDate(e.event_date ?? e.created_at)}
                    {e.reviewed_at ? " · approved by an editor" : " · published by the agent"}
                  </span>
                </p>
              </div>
              <div>
                {e.reversible ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">Reverse…</summary>
                    <div className="pt-3">
                      <ReverseForm eventId={e.id} />
                    </div>
                  </details>
                ) : (
                  <p className="text-xs text-muted-foreground">{!e.legislator
                    ? "Reversal is unavailable until the linked member record can be read."
                    : "No open affiliation is linked to this event. A later defection or departure may have closed it."}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminPage>
  );
}
