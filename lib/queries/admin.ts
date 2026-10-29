import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { chamber, num, parseRows } from "./shared";

// Admin reads use the signed-in admin's session: RLS lets admins see every
// event and run, and article bodies stay out of reach (column grants).

const party = z.object({ code: z.string(), name: z.string(), color: z.string().nullable() });

const queueRows = z.array(
  z.object({
    id: z.string(),
    raw_name: z.string(),
    chamber: chamber.nullable(),
    state: z.string().nullable(),
    event_type: z.string(),
    is_return: z.boolean(),
    event_date: z.string().nullable(),
    announced_date: z.string().nullable(),
    confidence: num,
    score_breakdown: z.record(z.string(), z.unknown()),
    review_flags: z.array(z.string()),
    review_note: z.string().nullable(),
    evidence_quote: z.string(),
    reasoning_summary: z.string().nullable(),
    model: z.string().nullable(),
    prompt_version: z.string().nullable(),
    created_at: z.string(),
    // Researched details of a backfilled state-assembly member, to pre-fill "add member".
    proposed_member: z
      .object({
        full_name: z.string(),
        constituency: z.string(),
        elected_party: z.string(),
        term_start: z.string(),
        source_url: z.string(),
        status: z.string(),
        left_office_on: z.string().nullable(),
      })
      .nullable(),
    legislator: z
      .object({
        id: z.string(),
        full_name: z.string(),
        chamber,
        state: z.string(),
        constituency: z.string(),
        is_fictional: z.boolean(),
        current_party: z.object({ code: z.string() }),
      })
      .nullable(),
    from_party: party.nullable(),
    to_party: party.nullable(),
    sources: z.array(
      z.object({
        evidence_quote: z.string(),
        article: z.object({ id: num, url: z.string(), outlet: z.string(), title: z.string(), published_at: z.string().nullable() }),
      }),
    ),
  }),
);
export type QueueItem = z.infer<typeof queueRows>[number];

const queueColumns =
  "id, raw_name, chamber, state, event_type, is_return, event_date, announced_date, confidence, score_breakdown, review_flags, review_note, " +
  "evidence_quote, reasoning_summary, model, prompt_version, created_at, proposed_member, " +
  "legislator:legislators(id, full_name, chamber, state, constituency, is_fictional, current_party:parties!legislators_current_party_id_fkey(code)), " +
  "from_party:parties!defection_events_from_party_id_fkey(code, name, color), " +
  "to_party:parties!defection_events_to_party_id_fkey(code, name, color), " +
  "sources:event_sources(evidence_quote, article:articles(id, url, outlet, title, published_at))";

/** Model name of researched backfill records (see draft_historical_events). */
export const BACKFILL_MODEL = "historical-import";

/** What the agent routed to review, highest score first. Backfill drafts are kept apart so they can't crowd it out. */
export async function getReviewQueue(): Promise<QueueItem[]> {
  const db = await createClient();
  const result = await db
    .from("defection_events")
    .select(queueColumns)
    .in("status", ["detected", "in_review"])
    .or(`model.is.null,model.neq.${BACKFILL_MODEL}`)
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  return parseRows(queueRows, result, "review queue");
}

/** Researched state-assembly records awaiting review, oldest first so a member's moves are approved in order. */
export async function getBackfillQueue(): Promise<QueueItem[]> {
  const db = await createClient();
  const result = await db
    .from("defection_events")
    .select(queueColumns)
    .in("status", ["detected", "in_review"])
    .eq("model", BACKFILL_MODEL)
    .order("event_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(100);
  return parseRows(queueRows, result, "backfill queue");
}

const memberRows = z.array(
  z.object({
    id: z.string(),
    full_name: z.string(),
    chamber,
    state: z.string(),
    is_fictional: z.boolean(),
    current_party: z.object({ code: z.string() }),
  }),
);
export type MemberOption = z.infer<typeof memberRows>[number];

/** Sitting members for the "correct the legislator" menu. */
export async function getMemberOptions(): Promise<MemberOption[]> {
  const db = await createClient();
  const result = await db
    .from("legislators")
    .select("id, full_name, chamber, state, is_fictional, current_party:parties!legislators_current_party_id_fkey(code)")
    .eq("status", "sitting")
    .order("state")
    .order("full_name");
  return parseRows(memberRows, result, "legislators");
}

const targetRows = z.array(
  z.object({
    id: z.string(),
    legislator_id: z.string().nullable(),
    status: z.string(),
    event_date: z.string().nullable(),
    created_at: z.string(),
    to_party: z.object({ code: z.string() }).nullable(),
  }),
);
export type MergeTarget = z.infer<typeof targetRows>[number];

/** Open or published events of the given members: the likely originals of a duplicate. */
export async function getMergeTargets(legislatorIds: string[]): Promise<MergeTarget[]> {
  if (legislatorIds.length === 0) return [];
  const db = await createClient();
  const result = await db
    .from("defection_events")
    .select("id, legislator_id, status, event_date, created_at, to_party:parties!defection_events_to_party_id_fkey(code)")
    .in("legislator_id", legislatorIds)
    .in("status", ["detected", "in_review", "published"])
    .order("created_at", { ascending: false });
  return parseRows(targetRows, result, "merge targets");
}

const publishedRows = z.array(
  z.object({
    id: z.string(),
    raw_name: z.string(),
    event_date: z.string().nullable(),
    created_at: z.string(),
    reviewed_at: z.string().nullable(),
    confidence: num,
    legislator: z.object({ id: z.string(), full_name: z.string(), chamber, state: z.string(), is_fictional: z.boolean() }).nullable(),
    from_party: z.object({ code: z.string() }).nullable(),
    to_party: z.object({ code: z.string() }),
    // The affiliation this event opened; still open means it is the member's latest move.
    affiliations: z.array(z.object({ end_date: z.string().nullable() })),
  }),
);
export type PublishedItem = z.infer<typeof publishedRows>[number] & { reversible: boolean };

export async function getPublished(limit = 50): Promise<PublishedItem[]> {
  const db = await createClient();
  const result = await db
    .from("defection_events")
    .select(
      "id, raw_name, event_date, created_at, reviewed_at, confidence, " +
        "legislator:legislators(id, full_name, chamber, state, is_fictional), " +
        "from_party:parties!defection_events_from_party_id_fkey(code), to_party:parties!defection_events_to_party_id_fkey(code), " +
        "affiliations:party_affiliations!party_affiliations_event_fk(end_date)",
    )
    .eq("status", "published")
    .order("event_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return parseRows(publishedRows, result, "published events").map((e) => ({
    ...e,
    reversible: e.legislator !== null && e.affiliations.some((a) => a.end_date === null),
  }));
}

const runRows = z.array(
  z.object({
    id: num,
    started_at: z.string(),
    finished_at: z.string().nullable(),
    feeds_ok: num,
    feeds_failed: num,
    articles_new: num,
    articles_prefiltered: num,
    llm_calls: num,
    input_tokens: num,
    output_tokens: num,
    events_created: num,
    events_published: num,
    errors: z.array(z.object({ where: z.string(), message: z.string() })).catch([]),
  }),
);
export type Run = z.infer<typeof runRows>[number];

export async function getRuns(limit = 50): Promise<Run[]> {
  const db = await createClient();
  const result = await db
    .from("agent_runs")
    .select(
      "id, started_at, finished_at, feeds_ok, feeds_failed, articles_new, articles_prefiltered, llm_calls, input_tokens, output_tokens, events_created, events_published, errors",
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  return parseRows(runRows, result, "agent_runs");
}
