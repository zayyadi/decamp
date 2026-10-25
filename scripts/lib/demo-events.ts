// Fictional defections for demo mode (CLAUDE.md rule 2): planned here as
// plain data, written by the `seed_demo_events` SQL function. Members are
// picked in a fixed (seeded) order, and members who already have a demo event
// count toward the quota, so a re-run plans no one new even though the first
// run changed their parties and dates.

export interface DemoLegislator {
  fullName: string;
  chamber: "senate" | "house";
  state: string;
  party: string;
  /** Start of the open affiliation (YYYY-MM-DD); a defection can't predate it. */
  since: string;
}

export interface DemoEvent {
  full_name: string;
  chamber: "senate" | "house";
  state: string;
  from_party: string;
  to_party: string;
  event_date: string;
  status: "published" | "in_review";
  evidence_quote: string;
  dedupe_key: string;
  article: { url: string; title: string; outlet: string; published_at: string };
}

export interface DemoOptions {
  today: string;
  published?: number;
  inReview?: number;
  /** How far back events are spread. */
  days?: number;
  seed?: number;
  /** dedupe_keys of demo events already in the database. */
  existing?: ReadonlySet<string>;
}

export const demoKey = (l: Pick<DemoLegislator, "chamber" | "state" | "fullName">) =>
  `demo:${slug(`${l.chamber}-${l.state}-${l.fullName}`)}`;

// Destination weights: lopsided on purpose so the charts show a clear net gainer.
const DESTINATIONS: [string, number][] = [
  ["APC", 8], ["PDP", 2], ["LP", 2], ["ADC", 3], ["SDP", 1], ["NNPP", 1], ["APGA", 1],
];

/** mulberry32: small, seedable, good enough for picking demo rows. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function planDemoEvents(legislators: DemoLegislator[], options: DemoOptions): DemoEvent[] {
  const { today, published = 24, inReview = 3, days = 182, seed = 2026, existing = new Set<string>() } = options;
  const random = rng(seed);
  const pool = [...legislators].sort((a, b) => a.fullName.localeCompare(b.fullName));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const events: DemoEvent[] = [];
  let planned = 0;
  for (const l of pool) {
    if (planned === published + inReview) break;
    if (existing.has(demoKey(l))) {
      planned++;
      continue;
    }
    const choices = DESTINATIONS.filter(([code]) => code !== l.party);
    let pick = random() * choices.reduce((sum, [, w]) => sum + w, 0);
    const to = choices.find(([, w]) => (pick -= w) < 0)?.[0] ?? choices[0][0];

    // Strictly after the current affiliation began, and at least a day ago.
    const maxAgo = Math.min(days, daysBetween(l.since, today) - 1);
    if (maxAgo < 1) continue;
    const eventDate = addDays(today, -(1 + Math.floor(random() * maxAgo)));

    const status = planned < published ? "published" : "in_review";
    planned++;
    const honorific = l.chamber === "senate" ? "Sen." : "Hon.";
    const title = `[Demo] ${honorific} ${l.fullName} ${status === "published" ? "joins" : "reportedly set to join"} ${to}`;
    events.push({
      full_name: l.fullName,
      chamber: l.chamber,
      state: l.state,
      from_party: l.party,
      to_party: to,
      event_date: eventDate,
      status,
      evidence_quote:
        status === "published"
          ? `"I have today formally registered as a member of the ${to}," the fictional legislator said.`
          : `Supporters say the fictional legislator is expected to join the ${to} soon.`,
      dedupe_key: demoKey(l),
      article: {
        // .invalid is reserved (RFC 2606): the link can never reach a real site.
        url: `https://demo.example.invalid/${slug(l.fullName)}-${to.toLowerCase()}`,
        title,
        outlet: "demo",
        published_at: `${eventDate}T09:00:00Z`,
      },
    });
  }
  return events;
}
