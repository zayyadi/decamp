import { nameTokens, tokenize } from "./normalize";
import { jaroWinkler, tokenSetRatio } from "./similarity";

// Entity resolution against the roster (AGENT.md §5.2). Pure: the roster is
// passed in, so the eval runs it on an in-memory copy.

export interface RosterEntry {
  id: string;
  fullName: string;
  nameVariants: string[];
  chamber: "senate" | "house" | "state_assembly";
  state: string;
  constituency: string;
  /** Party code, or null if the roster has none. */
  currentParty: string | null;
  status: string;
  isFictional: boolean;
}

export interface MatchQuery {
  name: string;
  chamber: "senate" | "house" | "state_assembly" | "unknown";
  state: string | null;
  constituency: string | null;
  fromParty: string | null;
}

export type MatchStatus = "UNIQUE" | "AMBIGUOUS" | "NO_MATCH" | "FORMER";

export interface MatchResult {
  status: MatchStatus;
  /** Set only when status is UNIQUE (or FORMER, for the log). */
  legislator: RosterEntry | null;
  score: number;
  runnerUpScore: number;
  flags: string[];
}

const UNIQUE_MIN = 0.92;
const UNIQUE_GAP = 0.08;
const AMBIGUOUS_MIN = 0.8;
const EXACT_ENOUGH = 0.96;
const CONSTITUENCY_MIN = 0.85;

const similarity = (a: string, b: string) => Math.max(jaroWinkler(a, b), tokenSetRatio(a, b));

/**
 * Surnames are the strongest signal. Every token after the first given name
 * counts, because hyphenated surnames split into several tokens and names are
 * often written surname-first.
 */
function surnameTokens(tokens: string[]): string[] {
  return tokens.length > 1 ? tokens.slice(1) : tokens;
}

function nameScore(queryTokens: string[], candidate: RosterEntry): number {
  const query = queryTokens.join(" ");
  let best = 0;
  for (const variant of [candidate.fullName, ...candidate.nameVariants]) {
    const tokens = nameTokens(variant);
    const s = similarity(query, tokens.join(" "));
    const surnames = surnameTokens(tokens);
    const overlap = queryTokens.some((t) => surnames.includes(t));
    if (overlap || s >= EXACT_ENOUGH) best = Math.max(best, s);
  }
  return best;
}

function normaliseState(state: string): string {
  const s = tokenize(state).filter((t) => t !== "state").join(" ");
  return s === "abuja" || s === "federal capital territory" ? "fct" : s;
}

interface Scored {
  entry: RosterEntry;
  score: number;
  partyMismatch: boolean;
}

function score(query: MatchQuery, queryTokens: string[], candidate: RosterEntry): Scored | null {
  const base = nameScore(queryTokens, candidate);
  if (base === 0) return null;

  let s = base;
  if (query.state && normaliseState(query.state) === normaliseState(candidate.state)) s += 0.05;
  if (
    query.constituency &&
    similarity(tokenize(query.constituency).join(" "), tokenize(candidate.constituency).join(" ")) >=
      CONSTITUENCY_MIN
  ) {
    s += 0.05;
  }
  let partyMismatch = false;
  if (query.fromParty) {
    if (query.fromParty === candidate.currentParty) s += 0.03;
    else {
      s -= 0.1;
      partyMismatch = true;
    }
  }
  return { entry: candidate, score: Math.min(1, Math.max(0, s)), partyMismatch };
}

function ranked(query: MatchQuery, queryTokens: string[], roster: RosterEntry[]): Scored[] {
  return roster
    .filter((c) => query.chamber === "unknown" || c.chamber === query.chamber)
    .map((c) => score(query, queryTokens, c))
    .filter((s): s is Scored => s !== null)
    .sort((a, b) => b.score - a.score);
}

/**
 * State-assembly defections always go to review in phase 1 (SPEC §3.1): the
 * assembly roster is still growing, so a match there is weaker evidence.
 */
export function matchLegislator(query: MatchQuery, roster: RosterEntry[]): MatchResult {
  const result = matchAmongRoster(query, roster);
  if (query.chamber === "state_assembly" || result.legislator?.chamber === "state_assembly") {
    return { ...result, flags: [...result.flags, "state_assembly"] };
  }
  return result;
}

function matchAmongRoster(query: MatchQuery, roster: RosterEntry[]): MatchResult {
  const queryTokens = nameTokens(query.name);
  const sitting = ranked(query, queryTokens, roster.filter((r) => r.status === "sitting"));
  const former = ranked(query, queryTokens, roster.filter((r) => r.status !== "sitting"));

  const top = sitting[0];
  const topScore = top?.score ?? 0;
  const runnerUpScore = sitting[1]?.score ?? 0;

  // Clearly a former member: the event is dropped, not resolved to a sitting namesake.
  const formerTop = former[0];
  if (formerTop && formerTop.score >= UNIQUE_MIN && formerTop.score - topScore >= UNIQUE_GAP) {
    return { status: "FORMER", legislator: formerTop.entry, score: formerTop.score, runnerUpScore: topScore, flags: [] };
  }

  if (top && topScore >= UNIQUE_MIN && topScore - runnerUpScore >= UNIQUE_GAP) {
    return {
      status: "UNIQUE",
      legislator: top.entry,
      score: topScore,
      runnerUpScore,
      flags: top.partyMismatch ? ["party_mismatch"] : [],
    };
  }
  if (topScore >= AMBIGUOUS_MIN) {
    return { status: "AMBIGUOUS", legislator: null, score: topScore, runnerUpScore, flags: ["ambiguous_entity"] };
  }
  return { status: "NO_MATCH", legislator: null, score: topScore, runnerUpScore, flags: ["unresolved_entity"] };
}
