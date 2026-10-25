// Event dedupe and corroboration (AGENT.md §6.1).

const WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

export interface EventKey {
  legislatorId: string;
  /** null matches any destination (denials and reversals often omit it). */
  toParty: string | null;
  /** YYYY-MM-DD, or null when the article gives no date. */
  eventDate: string | null;
  /** YYYY-MM-DD the article was published; stands in for a missing event date. */
  observedOn: string;
}

export interface ExistingEventKey {
  id: string;
  legislatorId: string | null;
  toParty: string | null;
  eventDate: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

const day = (iso: string) => Date.parse(iso.slice(0, 10));

/** The closest existing event for the same legislator and party within ±14 days. */
export function findMatchingEvent<E extends ExistingEventKey>(candidate: EventKey, events: E[]): E | undefined {
  const at = day(candidate.eventDate ?? candidate.observedOn);
  let best: { event: E; distance: number } | undefined;
  for (const event of events) {
    if (event.legislatorId !== candidate.legislatorId) continue;
    if (candidate.toParty !== null && event.toParty !== candidate.toParty) continue;
    const distance = Math.abs(day(event.eventDate ?? event.createdAt) - at) / DAY_MS;
    if (distance > WINDOW_DAYS) continue;
    if (!best || distance < best.distance) best = { event, distance };
  }
  return best?.event;
}

export interface SourceRef {
  outlet: string;
  contentHash: string | null;
}

/** Different outlets with different text. Wire copies of one story count once. */
export function independentOutlets(sources: SourceRef[]): number {
  const outlets = new Set<string>();
  const seenHashes = new Set<string>();
  for (const s of sources) {
    if (s.contentHash) {
      if (seenHashes.has(s.contentHash)) continue;
      seenHashes.add(s.contentHash);
    }
    outlets.add(s.outlet);
  }
  return outlets.size;
}
