"use client";

import { ArrowRightIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { createContext, useActionState, useContext, useState, type ReactNode } from "react";
import { approveEvent, mergeEvent, rejectEvent, saveEdits } from "@/app/admin/actions";
import { FictionalBadge, PartyBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { chamberShort, formatConfidence, formatDate, honorific } from "@/lib/format";
import type { MemberOption, MergeTarget, QueueItem } from "@/lib/queries/admin";
import { REJECT_REASONS } from "@/lib/review";
import { ActionMessage } from "./action-message";

interface Options {
  members: MemberOption[];
  parties: { code: string; name: string }[];
}

// Sent once for the whole queue rather than with every card.
const OptionsContext = createContext<Options>({ members: [], parties: [] });

export function ReviewOptions({ value, children }: { value: Options; children: ReactNode }) {
  return <OptionsContext value={value}>{children}</OptionsContext>;
}

const FLAG_LABELS: Record<string, string> = {
  ambiguous_entity: "Ambiguous member",
  party_mismatch: "Party doesn't match roster",
  speculative_language: "Speculative language",
  quote_not_verbatim: "Quote not verbatim",
  unnamed_group_remainder: "Unnamed group members",
  single_low_tier_source: "Single low-tier source",
};

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {text}
      {children}
    </label>
  );
}

function PartySelect({ name, value, allowEmpty }: { name: string; value: string | null; allowEmpty?: boolean }) {
  const { parties } = useContext(OptionsContext);
  return (
    <NativeSelect name={name} defaultValue={value ?? ""} className="w-full">
      {allowEmpty || !value ? <NativeSelectOption value="">{allowEmpty ? "Unknown" : "Choose…"}</NativeSelectOption> : null}
      {parties.map((p) => (
        <NativeSelectOption key={p.code} value={p.code}>
          {p.code} · {p.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function MemberSelect({ value }: { value: string | null }) {
  const { members } = useContext(OptionsContext);
  const byState = Map.groupBy(members, (m) => m.state);
  return (
    <NativeSelect name="legislator_id" defaultValue={value ?? ""} className="w-full">
      {!value ? <NativeSelectOption value="">Choose the member…</NativeSelectOption> : null}
      {[...byState].map(([state, list]) => (
        <NativeSelectOptGroup key={state} label={state}>
          {list.map((m) => (
            <NativeSelectOption key={m.id} value={m.id}>
              {honorific(m.chamber)} {m.full_name} ({m.current_party.code})
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
    </NativeSelect>
  );
}

function DecisionForm({ item }: { item: QueueItem }) {
  const [approveState, approve, approving] = useActionState(approveEvent, null);
  const [saveState, save, saving] = useActionState(saveEdits, null);
  const [changeMember, setChangeMember] = useState(!item.legislator);
  const pending = approving || saving;
  return (
    <form className="space-y-3" aria-busy={pending}>
      <input type="hidden" name="event_id" value={item.id} />
      <input type="hidden" name="orig_legislator_id" value={item.legislator?.id ?? ""} />
      <input type="hidden" name="orig_from_party" value={item.from_party?.code ?? ""} />
      <input type="hidden" name="orig_to_party" value={item.to_party?.code ?? ""} />
      <input type="hidden" name="orig_event_date" value={item.event_date ?? ""} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {changeMember ? (
            <Label text="Member">
              <MemberSelect value={item.legislator?.id ?? null} />
            </Label>
          ) : (
            <p className="text-xs font-medium text-muted-foreground">
              Member{" "}
              <button type="button" className="ml-1 font-semibold text-highlight hover:underline" onClick={() => setChangeMember(true)}>
                Change
              </button>
            </p>
          )}
        </div>
        <Label text="From party">
          <PartySelect name="from_party" value={item.from_party?.code ?? null} allowEmpty />
        </Label>
        <Label text="To party">
          <PartySelect name="to_party" value={item.to_party?.code ?? null} />
        </Label>
        <Label text="Defection date">
          <Input type="date" name="event_date" defaultValue={item.event_date ?? ""} className="bg-card" />
        </Label>
        <Label text="Note (optional, kept with the event)">
          <Input name="note" maxLength={1000} placeholder="e.g. Confirmed in plenary" className="bg-card" />
        </Label>
      </div>
      <ActionMessage state={approveState} />
      <ActionMessage state={saveState} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" formAction={approve} disabled={pending}>
          Approve and publish
        </Button>
        <Button type="submit" variant="outline" formAction={save} disabled={pending}>
          Save changes only
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Publishing changes party counts and sends a Confirmed alert to everyone.</p>
    </form>
  );
}

function RejectForm({ item }: { item: QueueItem }) {
  const [state, action, pending] = useActionState(rejectEvent, null);
  return (
    <form action={action} className="space-y-3" aria-busy={pending}>
      <input type="hidden" name="event_id" value={item.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text="Reason">
          <NativeSelect name="reason" defaultValue="" required className="w-full">
            <NativeSelectOption value="" disabled>
              Choose a reason…
            </NativeSelectOption>
            {REJECT_REASONS.map((r) => (
              <NativeSelectOption key={r.value} value={r.value}>
                {r.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label text="Note">
          <Input name="note" maxLength={1000} placeholder="Required for “Other”" className="bg-card" />
        </Label>
      </div>
      <ActionMessage state={state} />
      <Button type="submit" variant="destructive" disabled={pending}>
        Reject
      </Button>
    </form>
  );
}

function MergeForm({ item, targets }: { item: QueueItem; targets: MergeTarget[] }) {
  const [state, action, pending] = useActionState(mergeEvent, null);
  const candidates = targets.filter((t) => t.id !== item.id);
  return (
    <form action={action} className="space-y-3" aria-busy={pending}>
      <input type="hidden" name="event_id" value={item.id} />
      {candidates.length ? (
        <Label text="Original event for this member">
          <NativeSelect name="target_id" defaultValue={candidates[0].id} className="w-full">
            {candidates.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.status} · to {t.to_party?.code ?? "?"} · {formatDate(t.event_date ?? t.created_at)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
      ) : (
        <Label text="Event ID to merge into">
          <Input name="target_id" placeholder="Paste the original event's ID" className="bg-card font-mono" />
        </Label>
      )}
      <Label text="Note (optional)">
        <Input name="note" maxLength={1000} className="bg-card" />
      </Label>
      <ActionMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        Merge as duplicate
      </Button>
    </form>
  );
}

export function ReviewCard({ item, targets }: { item: QueueItem; targets: MergeTarget[] }) {
  const l = item.legislator;
  return (
    <article className="grid gap-5 rounded-2xl border bg-card p-5 lg:grid-cols-[3fr_2fr]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-accent-foreground">
            Score {formatConfidence(item.confidence)}
          </span>
          {item.review_flags.map((f) => (
            <span key={f} className="rounded-full border border-unverified-border bg-unverified px-2 py-0.5 font-medium text-unverified-foreground">
              {FLAG_LABELS[f] ?? f}
            </span>
          ))}
          {l?.is_fictional ? <FictionalBadge /> : null}
          <span className="ml-auto text-muted-foreground">Detected {formatDate(item.created_at)}</span>
        </div>

        <div className="space-y-1">
          <h2 className="font-heading text-2xl leading-tight font-bold">
            {l ? (
              <Link href={`/legislators/${l.id}`} className="hover:text-primary">
                {honorific(l.chamber)} {l.full_name}
              </Link>
            ) : (
              <span>Unresolved: “{item.raw_name}”</span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {l ? `${chamberShort(l.chamber)} · ${l.constituency}, ${l.state} · now ${l.current_party.code} · ` : ""}
            written as “{item.raw_name}”
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <PartyBadge code={item.from_party?.code ?? null} color={item.from_party?.color} />
          <ArrowRightIcon className="size-4 text-highlight" aria-label="to" />
          <PartyBadge code={item.to_party?.code ?? null} color={item.to_party?.color} />
          <span className="text-muted-foreground">· {item.event_date ? formatDate(item.event_date) : "date unknown"}</span>
          {item.is_return ? <span className="text-muted-foreground">· return to a former party</span> : null}
        </div>

        {item.review_note ? (
          <p className="rounded-lg border border-unverified-border bg-unverified px-3 py-2 text-sm text-unverified-foreground">{item.review_note}</p>
        ) : null}

        <blockquote className="border-l-4 border-primary pl-3 text-sm italic">{item.evidence_quote}</blockquote>
        {item.reasoning_summary ? <p className="text-sm text-muted-foreground">{item.reasoning_summary}</p> : null}

        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sources ({item.sources.length})</p>
          <ul className="space-y-1.5 text-sm">
            {item.sources.map((s) => (
              <li key={s.article.id}>
                <a href={s.article.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 font-medium hover:underline">
                  {s.article.title} <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <span className="text-xs text-muted-foreground"> · {s.article.outlet} · {formatDate(s.article.published_at)}</span>
              </li>
            ))}
          </ul>
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium hover:text-foreground">Score breakdown and model</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {Object.entries(item.score_breakdown).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono">{k}</dt>
                <dd className="font-mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
            <dt className="font-mono">model</dt>
            <dd className="font-mono">
              {item.model ?? "–"} · prompt {item.prompt_version ?? "–"}
            </dd>
          </dl>
        </details>
      </div>

      <div className="space-y-4 rounded-xl bg-muted p-4">
        <DecisionForm item={item} />
        <details className="group border-t pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">Reject…</summary>
          <div className="pt-3">
            <RejectForm item={item} />
          </div>
        </details>
        <details className="group border-t pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">Merge into another event…</summary>
          <div className="pt-3">
            <MergeForm item={item} targets={targets} />
          </div>
        </details>
      </div>
    </article>
  );
}
