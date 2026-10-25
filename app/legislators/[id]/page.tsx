import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FictionalBadge, PartyBadge } from "@/components/badges";
import { SectionCard } from "@/components/section-card";
import { chamberLabel, formatDate, honorific } from "@/lib/format";
import { partyColor } from "@/lib/parties";
import { getLegislator, type Profile as ProfileData } from "@/lib/queries/legislators";

export const metadata: Metadata = { title: "Legislator" };

export default function LegislatorPage({ params }: PageProps<"/legislators/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/legislators" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" aria-hidden /> All legislators
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy aria-label="Loading profile" />}>
        <Profile params={params} />
      </Suspense>
    </main>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const STATUS: Record<ProfileData["status"], string> = {
  sitting: "Sitting member",
  former: "Former member",
  deceased: "Deceased",
  vacated: "Seat vacated",
};

async function Profile({ params }: { params: PageProps<"/legislators/[id]">["params"] }) {
  const { id } = await params;
  const l = await getLegislator(id);
  if (!l) notFound();

  return (
    <>
      <section className="flex flex-col gap-6 rounded-2xl border bg-muted p-6 sm:flex-row sm:items-center">
        {l.photo_url ? (
          <Image src={l.photo_url} alt="" width={112} height={112} unoptimized className="size-28 rounded-2xl object-cover" />
        ) : (
          <div
            aria-hidden
            className="grid size-28 shrink-0 place-items-center rounded-2xl font-heading text-4xl font-bold text-white"
            style={{ backgroundColor: partyColor(l.current_party.code, l.current_party.color) }}
          >
            {initials(l.full_name)}
          </div>
        )}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <PartyBadge code={l.current_party.code} color={l.current_party.color} name={l.current_party.name} />
            <span className="text-sm text-muted-foreground">{STATUS[l.status]}</span>
            {l.is_fictional ? <FictionalBadge /> : null}
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight">
            <span className="text-muted-foreground">{honorific(l.chamber)} </span>
            {l.full_name}
          </h1>
          <p className="text-muted-foreground">
            {chamberLabel(l.chamber)} · {l.constituency}, {l.state}
          </p>
          {l.name_variants.length ? (
            <p className="text-xs text-muted-foreground">Also written as: {l.name_variants.join(", ")}</p>
          ) : null}
        </div>
      </section>

      <SectionCard title="Party history" description={`Elected on the ${l.elected_party.name} (${l.elected_party.code}) ticket. Newest first.`}>
        <ol className="relative space-y-6 border-l-2 border-accent pl-6">
          {l.history.map((h) => (
            <li key={h.id} className="relative">
              <span
                aria-hidden
                className="absolute top-1 -left-[33px] size-4 rounded-full border-4 border-card"
                style={{ backgroundColor: partyColor(h.party.code, h.party.color) }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <PartyBadge code={h.party.code} color={h.party.color} />
                <span className="font-medium">{h.party.name}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(h.start_date)} – {h.end_date ? formatDate(h.end_date) : "present"}
              </p>
              <p className="mt-1 text-sm">
                {h.defection_event_id ? (
                  <Link href={`/events/${h.defection_event_id}`} className="font-medium text-highlight hover:underline">
                    See the confirmed defection and its sources
                  </Link>
                ) : h.source_url ? (
                  <a href={h.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-highlight hover:underline">
                    Source <ExternalLinkIcon className="size-3.5" aria-hidden />
                  </a>
                ) : (
                  <span className="text-muted-foreground">From the roster</span>
                )}
              </p>
            </li>
          ))}
        </ol>
      </SectionCard>

      {l.source_url ? (
        <p className="text-xs text-muted-foreground">
          Roster entry verified {formatDate(l.verified_at)} against{" "}
          <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="underline">
            this source
          </a>
          .
        </p>
      ) : null}
    </>
  );
}
