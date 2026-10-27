import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, SectionCard } from "@/components/section-card";
import { getSiteEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Methodology and corrections", description: "How DecampWatch NG verifies National Assembly defections, records sources, and handles corrections." };

export default function AboutPage() {
  const { NEXT_PUBLIC_CORRECTIONS_URL: contact } = getSiteEnv();
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeading eyebrow="About DecampWatch NG" title="Methodology and corrections">
        Tracking completed party changes in Nigeria&apos;s 10th National Assembly and its State Houses of Assembly, with evidence you can inspect.
      </PageHeading>
      <SectionCard title="What we track">
        <p>We cover the Senate and House of Representatives from the term that began on 13 June 2023, and, in a separate <Link className="font-medium text-highlight underline underline-offset-4" href="/assemblies">State Assemblies</Link> section, members of the 36 State Houses of Assembly. Assembly figures are never added to National Assembly counts. Governors, candidates and former members&apos; subsequent party changes are outside this scope. A historical move by someone who later left office can remain in the record.</p>
        <p className="mt-3">State-assembly coverage is new. An editor checks every state-assembly report before it appears, and assembly members are recorded as their defections are confirmed, so we don&apos;t yet show assembly seat totals.</p>
        <p className="mt-3">Our historical preview is a partial, sourced backfill. Party strength reflects the members and affiliation histories recorded in our database; it is not a full chamber census. Missing records do not mean no defection occurred. The dashboard coverage notice identifies the latest included historical event.</p>
      </SectionCard>
      <SectionCard title="How a report becomes a record">
        <ol className="list-decimal space-y-3 pl-5">
          <li>An automated agent checks configured Nigerian news feeds and reads relevant reports, subject to publisher access rules.</li>
          <li>It distinguishes completed moves and formal plenary announcements from rumours, intentions, denials and legal challenges, then matches named people to the legislator roster.</li>
          <li>A confidence score considers evidence, source quality, corroboration and identity matching. A score of at least 85% can qualify for automatic publication; an editor can also approve a reviewed report. A score is an assessment, not a guarantee of accuracy.</li>
          <li>Only published defections change party counts. Unverified reports and items awaiting review do not. Historical imports cite researched sources and are labelled separately from AI detections.</li>
        </ol>
      </SectionCard>
      <SectionCard title="Sources, dates and corrections">
        <p>Each event links to its sources and includes a short evidence excerpt. We prefer official parliamentary proceedings where available; contemporary reporting is identified by outlet. Publication dates and defection dates can differ. A plenary announcement date is recorded separately when established.</p>
        <p className="mt-3">Repeated party changes remain separate events. An editor can correct a mistaken record by reversing its latest party change and publishing a correction note. Earlier moves must be unwound in reverse order so membership history stays consistent.</p>
        <p className="mt-3">If you spot an error, include the event link, the disputed name, party or date, and a reliable source supporting the correction. Please send only information needed to assess the record.</p>
        {contact ? <a className="mt-4 inline-block font-medium text-highlight underline underline-offset-4" href={contact}>Request a correction</a> : <p className="mt-4 rounded-xl border bg-muted p-3 text-sm">A public corrections contact has not been configured yet. This preview is not ready for public launch.</p>}
      </SectionCard>
      <SectionCard title="Disclaimer and privacy">
        <p>DecampWatch NG is an independent information tool, not an official National Assembly or INEC register. Recording a party change does not determine whether it is lawful or whether a seat should be vacated. Consult the linked sources and official records before relying on a report.</p>
        <p className="mt-3">Public browsing requires no account. Editor sign-in uses Supabase authentication and session cookies. Hosting and database providers process requests to operate the service; correction messages are handled through the contact channel above.</p>
      </SectionCard>
      <Link href="/" className="text-sm font-medium text-highlight hover:underline">Return to the dashboard</Link>
    </main>
  );
}
