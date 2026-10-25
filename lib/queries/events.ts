import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./legislators";
import { chamber, num, parseRows } from "./shared";

const party = z.object({ code: z.string(), name: z.string(), color: z.string().nullable() });

// defection_events has column-level grants: list the columns, never `*`.
const EVENT_COLUMNS =
  "id, raw_name, event_type, is_return, event_date, announced_date, reason_given, confidence, status, " +
  "evidence_quote, reasoning_summary, model, prompt_version, created_at, updated_at, " +
  "legislator:legislators(id, full_name, chamber, state, constituency, is_fictional), " +
  "from_party:parties!defection_events_from_party_id_fkey(code, name, color), " +
  "to_party:parties!defection_events_to_party_id_fkey(code, name, color), " +
  "sources:event_sources(evidence_quote, article:articles(id, url, outlet, title, published_at))";

const eventRow = z.object({
  id: z.string(),
  raw_name: z.string(),
  event_type: z.string(),
  is_return: z.boolean(),
  event_date: z.string().nullable(),
  announced_date: z.string().nullable(),
  reason_given: z.string().nullable(),
  confidence: num,
  status: z.string(),
  evidence_quote: z.string(),
  reasoning_summary: z.string().nullable(),
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  legislator: z.object({
    id: z.string(),
    full_name: z.string(),
    chamber,
    state: z.string(),
    constituency: z.string(),
    is_fictional: z.boolean(),
  }),
  from_party: party.nullable(),
  to_party: party,
  sources: z.array(
    z.object({
      evidence_quote: z.string(),
      article: z.object({
        id: num,
        url: z.string(),
        outlet: z.string(),
        title: z.string(),
        published_at: z.string().nullable(),
      }),
    }),
  ),
});
export type EventDetail = z.infer<typeof eventRow>;

const alertRows = z.array(
  z.object({
    id: num,
    kind: z.enum(["published", "developing", "correction", "group_developing"]),
    level: z.enum(["confirmed", "unverified"]),
    title: z.string(),
    body: z.string(),
    created_at: z.string(),
  }),
);
export type EventAlert = z.infer<typeof alertRows>[number];

export interface EventPage {
  /** Null when the event isn't public: not published yet, or withdrawn. */
  event: EventDetail | null;
  alerts: EventAlert[];
}

/** An event with its sources and alerts. A withdrawn event still has its correction alert. */
export async function getEvent(id: string): Promise<EventPage | null> {
  if (!isUuid(id)) return null;
  const db = await createClient();
  const [event, alerts] = await Promise.all([
    db.from("defection_events").select(EVENT_COLUMNS).eq("id", id).maybeSingle(),
    db.from("alerts").select("id, kind, level, title, body, created_at").eq("event_id", id).order("created_at"),
  ]);
  const page = {
    event: parseRows(eventRow.nullable(), event, "defection_event"),
    alerts: parseRows(alertRows, alerts, "alerts"),
  };
  return page.event || page.alerts.length ? page : null;
}

const legislatorEventRows = z.array(
  z.object({
    id: z.string(),
    event_date: z.string().nullable(),
    announced_date: z.string().nullable(),
    created_at: z.string(),
    is_return: z.boolean(),
    from_party: z.object({ code: z.string() }).nullable(),
    to_party: z.object({ code: z.string() }),
  }),
);
export type LegislatorEvent = z.infer<typeof legislatorEventRows>[number];

/** Published defections of one legislator, newest first. */
export async function getLegislatorEvents(legislatorId: string): Promise<LegislatorEvent[]> {
  const db = await createClient();
  const result = await db
    .from("defection_events")
    .select(
      "id, event_date, announced_date, created_at, is_return, " +
        "from_party:parties!defection_events_from_party_id_fkey(code), to_party:parties!defection_events_to_party_id_fkey(code)",
    )
    .eq("legislator_id", legislatorId)
    .eq("status", "published")
    .order("event_date", { ascending: false, nullsFirst: false });
  return parseRows(legislatorEventRows, result, "defection_events");
}
