import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { DetectStore, NewAlert, NewEvent, PendingArticle, StoredBreakdown, StoredEvent } from "./detect";
import type { RosterEntry } from "./resolve/match";

// Database writes for the detection stage. Idempotency rests on unique keys:
// defection_events.dedupe_key, event_sources (event_id, article_id) and
// alerts.dedupe_key. Party counts change only through publish_defection.

function check<T>(schema: z.ZodType<T>, result: { data: unknown; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return schema.parse(result.data);
}

const partyRows = z.array(z.object({ id: z.number(), code: z.string(), name: z.string(), aliases: z.array(z.string()) }));
export type PartyRow = z.infer<typeof partyRows>[number];

export async function loadParties(db: SupabaseClient): Promise<PartyRow[]> {
  return check(partyRows, await db.from("parties").select("id, code, name, aliases"), "load parties");
}

const legislatorRows = z.array(
  z.object({
    id: z.string(),
    full_name: z.string(),
    name_variants: z.array(z.string()),
    chamber: z.enum(["senate", "house", "state_assembly"]),
    state: z.string(),
    constituency: z.string(),
    status: z.string(),
    is_fictional: z.boolean(),
    current_party_id: z.number().nullable(),
  }),
);

export async function loadRoster(db: SupabaseClient, parties: PartyRow[]): Promise<RosterEntry[]> {
  const code = new Map(parties.map((p) => [p.id, p.code]));
  const rows = check(
    legislatorRows,
    await db
      .from("legislators")
      .select("id, full_name, name_variants, chamber, state, constituency, status, is_fictional, current_party_id"),
    "load roster",
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    nameVariants: r.name_variants,
    chamber: r.chamber,
    state: r.state,
    constituency: r.constituency,
    currentParty: r.current_party_id === null ? null : (code.get(r.current_party_id) ?? null),
    status: r.status,
    isFictional: r.is_fictional,
  }));
}

const EVENT_COLUMNS = "id, legislator_id, to_party_id, event_date, created_at, status, review_flags, reviewed_at, score_breakdown";

const eventRow = z.object({
  id: z.string(),
  legislator_id: z.string().nullable(),
  to_party_id: z.number().nullable(),
  event_date: z.string().nullable(),
  created_at: z.string(),
  status: z.string(),
  review_flags: z.array(z.string()),
  reviewed_at: z.string().nullable(),
  // Written only by this module; its shape is StoredBreakdown.
  score_breakdown: z.record(z.string(), z.unknown()),
});

const articleRows = z.array(
  z.object({
    id: z.number(),
    url: z.string(),
    outlet: z.string(),
    title: z.string(),
    published_at: z.string().nullable(),
    content: z.string().nullable(),
    content_hash: z.string().nullable(),
  }),
);

const ARTICLE_COLUMNS = "id, url, outlet, title, published_at, content, content_hash";

const toPending = (a: z.infer<typeof articleRows>[number]): PendingArticle => ({
  id: a.id,
  url: a.url,
  outlet: a.outlet,
  title: a.title,
  publishedAt: a.published_at,
  content: a.content,
  contentHash: a.content_hash,
});

/** Articles still waiting for detection, by URL (`--article`). */
export async function articleByUrl(db: SupabaseClient, url: string): Promise<PendingArticle | null> {
  const rows = check(articleRows, await db.from("articles").select(ARTICLE_COLUMNS).eq("url", url), "load article");
  return rows[0] ? toPending(rows[0]) : null;
}

export function supabaseDetectStore(db: SupabaseClient, parties: PartyRow[]): DetectStore {
  const idOf = new Map(parties.map((p) => [p.code, p.id]));
  const codeOf = new Map(parties.map((p) => [p.id, p.code]));
  const partyId = (code: string | null) => (code === null ? null : (idOf.get(code) ?? null));

  const toStored = (r: z.infer<typeof eventRow>): StoredEvent => ({
    id: r.id,
    legislatorId: r.legislator_id,
    toParty: r.to_party_id === null ? null : (codeOf.get(r.to_party_id) ?? null),
    eventDate: r.event_date,
    createdAt: r.created_at,
    status: r.status,
    flags: r.review_flags,
    reviewed: r.reviewed_at !== null,
    breakdown: r.score_breakdown as StoredBreakdown,
  });

  return {
    async pendingArticles(limit) {
      const rows = check(
        articleRows,
        await db
          .from("articles")
          .select(ARTICLE_COLUMNS)
          .eq("prefilter_hit", true)
          .is("classification", null)
          .order("published_at", { ascending: true, nullsFirst: false })
          .limit(limit),
        "load pending articles",
      );
      return rows.map(toPending);
    },

    async syndicatedFrom(article) {
      if (!article.contentHash) return null;
      const rows = check(
        z.array(z.object({ id: z.number(), classification: z.string() })),
        await db
          .from("articles")
          .select("id, classification")
          .eq("content_hash", article.contentHash)
          .neq("id", article.id)
          .not("classification", "is", null)
          .not("classification", "in", "(ERROR,NO_TEXT,DUPLICATE)")
          .order("id")
          .limit(1),
        "look up syndicated copy",
      );
      return rows[0] ? { articleId: rows[0].id, classification: rows[0].classification } : null;
    },

    async eventsSourcedBy(articleId) {
      const rows = check(
        z.array(z.object({ evidence_quote: z.string(), defection_events: eventRow })),
        await db.from("event_sources").select(`evidence_quote, defection_events (${EVENT_COLUMNS})`).eq("article_id", articleId),
        "load events for article",
      );
      return rows.map((r) => ({ ...toStored(r.defection_events), quote: r.evidence_quote }));
    },

    async eventsFor(legislatorId) {
      const rows = check(
        z.array(eventRow),
        await db
          .from("defection_events")
          .select(EVENT_COLUMNS)
          .eq("legislator_id", legislatorId)
          .in("status", ["detected", "in_review", "published", "rejected"]),
        "load legislator events",
      );
      return rows.map(toStored);
    },

    async insertEvent(event: NewEvent) {
      const { from_party, to_party, ...rest } = event;
      const inserted = check(
        z.array(z.object({ id: z.string() })),
        await db
          .from("defection_events")
          .upsert(
            { ...rest, from_party_id: partyId(from_party), to_party_id: partyId(to_party) },
            { onConflict: "dedupe_key", ignoreDuplicates: true },
          )
          .select("id"),
        "insert event",
      );
      if (inserted[0]) return { id: inserted[0].id, created: true };
      const existing = check(
        z.object({ id: z.string() }),
        await db.from("defection_events").select("id").eq("dedupe_key", event.dedupe_key).single(),
        "find existing event",
      );
      return { id: existing.id, created: false };
    },

    async addSource(eventId, articleId, quote) {
      const { error } = await db
        .from("event_sources")
        .upsert(
          { event_id: eventId, article_id: articleId, evidence_quote: quote },
          { onConflict: "event_id,article_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(`add source: ${error.message}`);
    },

    async updateEvent(id, patch) {
      const { error } = await db.from("defection_events").update(patch).eq("id", id);
      if (error) throw new Error(`update event: ${error.message}`);
    },

    async publish(eventId) {
      const { error } = await db.rpc("publish_defection", { p_event_id: eventId });
      return error ? error.message : null;
    },

    async insertAlert(alert: NewAlert) {
      const { error } = await db.from("alerts").upsert(alert, { onConflict: "dedupe_key", ignoreDuplicates: true });
      if (error) throw new Error(`insert alert: ${error.message}`);
    },

    async markArticle(id, classification) {
      const { error } = await db
        .from("articles")
        .update({ classification, processed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`mark article: ${error.message}`);
    },
  };
}

/** Reads go to the database; writes are logged by the caller but not made (`--dry-run`). */
export function dryRunDetectStore(real: DetectStore): DetectStore {
  let n = 0;
  return {
    pendingArticles: (limit) => real.pendingArticles(limit),
    syndicatedFrom: (article) => real.syndicatedFrom(article),
    eventsSourcedBy: (id) => real.eventsSourcedBy(id),
    eventsFor: (id) => real.eventsFor(id),
    insertEvent: async () => ({ id: `dry-run-${++n}`, created: true }),
    addSource: async () => {},
    updateEvent: async () => {},
    publish: async () => null,
    insertAlert: async () => {},
    markArticle: async () => {},
  };
}
