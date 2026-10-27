import { z } from "zod";

const date = z.iso.date();
const party = z.string().regex(/^[A-Z]{1,8}$/);
export const historicalEventSchema = z.object({
  full_name: z.string().trim().min(2),
  chamber: z.enum(["senate", "house", "state_assembly"]),
  state: z.string().min(2),
  constituency: z.string().min(2),
  elected_party: party,
  term_start: date.default("2023-06-13"),
  from_party: party,
  to_party: party,
  event_date: date,
  announced_date: date.optional(),
  source_url: z.url({ protocol: /^https$/ }),
  source_title: z.string().min(2),
  outlet: z.string().min(2),
  published_at: z.iso.datetime({ offset: true }),
  evidence_quote: z.string().trim().min(5).max(300),
  verified_at: date,
  status: z.enum(["sitting", "former", "deceased", "vacated"]).default("sitting"),
  left_office_on: date.optional(),
});
export type HistoricalEvent = z.infer<typeof historicalEventSchema>;

export function historicalKey(e: HistoricalEvent): string {
  return `historical:${[e.chamber, e.state, e.constituency, e.full_name, e.event_date, e.from_party, e.to_party].map(encodeURIComponent).join(":")}`;
}

/** Validate the entire backfill before opening a database connection. */
export function parseHistoricalEvents(input: unknown, today: string): HistoricalEvent[] {
  const events = z.array(historicalEventSchema).min(1).parse(input)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const keys = new Set<string>();
  const members = new Map<string, HistoricalEvent>();
  for (const e of events) {
    const key = historicalKey(e);
    if (keys.has(key)) throw new Error(`Duplicate historical event: ${e.full_name} ${e.event_date}`);
    keys.add(key);
    // State assemblies were inaugurated on different days in early June 2023.
    const termFloor = e.chamber === "state_assembly" ? "2023-06-01" : "2023-06-13";
    if (e.event_date < e.term_start || e.term_start < termFloor || e.event_date > today || e.verified_at > today ||
      (e.announced_date && (e.announced_date < e.event_date || e.announced_date > today)) ||
      (e.left_office_on && e.left_office_on > today)) {
      throw new Error(`Historical date outside the verified term: ${e.full_name}`);
    }
    if (e.from_party === e.to_party) throw new Error(`Unchanged party: ${e.full_name}`);
    if ((e.status !== "sitting") !== Boolean(e.left_office_on) || (e.left_office_on && e.left_office_on < e.event_date)) {
      throw new Error(`Invalid departure date: ${e.full_name}`);
    }
    const memberKey = [e.chamber, e.state, e.constituency, e.full_name].join("|");
    const previous = members.get(memberKey);
    if (previous ? previous.to_party !== e.from_party || previous.event_date >= e.event_date || previous.elected_party !== e.elected_party : e.elected_party !== e.from_party) {
      throw new Error(`Missing or inconsistent party history: ${e.full_name}`);
    }
    members.set(memberKey, e);
  }
  return events;
}
