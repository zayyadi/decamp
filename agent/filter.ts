// Keyword pre-filter (AGENT.md §3). Recall matters more than precision here:
// anything this drops never reaches the classifier.

export interface PartyNames {
  code: string;
  name: string;
  aliases: string[];
}

export interface FilterInput {
  title: string;
  summary: string;
  body?: string | null;
}

const SHORT_SUMMARY = 200;
const BODY_PREFIX = 1500;

const LEGISLATOR_CUE =
  /senator|\bsen\.|senate|house of representatives|\breps?\b|\bhon\.|honourable|honorable|lawmaker|legislator|member representing|federal constituency|senatorial district|plenary|national assembly|\bnass\b|speaker|senate president/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One-letter codes are skipped: Accord's "A" would make "joined a protest" a
// defection cue. The party still matches by name ("Accord", "Accord Party").
function partyPattern(parties: PartyNames[]): string {
  const names = new Set<string>();
  for (const p of parties) {
    for (const n of [p.code, p.name, ...p.aliases]) {
      const clean = n.trim().toLowerCase();
      if (clean.length > 1) names.add(escape(clean).replace(/\s+/g, "\\s+"));
    }
  }
  // Longest first, so a full name wins over a shorter name it starts with.
  return `(?:${[...names].sort((a, b) => b.length - a.length).join("|")})\\b`;
}

export function defectionCue(parties: PartyNames[]): RegExp {
  const p = partyPattern(parties);
  return new RegExp(
    [
      "defect(s|ed|ion|ions|or|ors)?",
      "decamp(s|ed|ment)?",
      "cross(es|ed)?\\s+(over|carpet)",
      `dump(s|ed)?\\s+(the\\s+)?(party|${p})`,
      `(join(s|ed)?|move(s|d)?\\s+to|switch(es|ed)?\\s+to)\\s+(the\\s+)?(${p})`,
      "resign(s|ed)?\\s+(his|her|their)?\\s*membership",
      `leave(s)?\\s+(the\\s+)?(${p})`,
      `(ditch|quit)(s|ted)?\\s+(the\\s+)?(${p})`,
    ].join("|"),
    "i",
  );
}

/** Whether the feed summary is too short to judge, so the body should be checked. */
export const needsBody = (summary: string) => summary.length < SHORT_SUMMARY;

export function filterText({ title, summary, body }: FilterInput): string {
  const rest = needsBody(summary) && body ? body.slice(0, BODY_PREFIX) : summary;
  return `${title}\n${rest}`;
}

/** Both cue groups must match (AGENT.md §3). */
export function buildPrefilter(parties: PartyNames[]): (input: FilterInput) => boolean {
  const defection = defectionCue(parties);
  return (input) => {
    const text = filterText(input);
    return defection.test(text) && LEGISLATOR_CUE.test(text);
  };
}

/** For trimming long bodies (AGENT.md §4.4): a passage worth keeping mentions either cue. */
export function buildRelevance(parties: PartyNames[]): (passage: string) => boolean {
  const defection = defectionCue(parties);
  return (passage) => defection.test(passage) || LEGISLATOR_CUE.test(passage);
}
