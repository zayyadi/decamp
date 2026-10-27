import { verbatimFlags } from "./classify/classify";
import {
  isPublishable,
  OTHER_PARTY,
  type ClassifierOutput,
  type EvidenceType,
  type ExtractedLegislator,
} from "./classify/schema";
import { independentOutlets } from "./corroborate";
import { matchLegislator, type MatchResult, type RosterEntry } from "./resolve/match";
import { hardGates, routeEvent, type Route, type Thresholds } from "./route";
import { scoreEvent, type ScoreBreakdown } from "./score";
import type { Tier } from "./sources";

// Pure decision logic shared by the agent and the eval: classifier output →
// per-legislator plans, and sources → score, gates and route.

export interface ArticleMeta {
  id: number;
  outlet: string;
  tier: Tier;
  contentHash: string | null;
  /** YYYY-MM-DD */
  publishedOn: string;
  /** Title and body as given to the model; evidence quotes are checked against it. */
  text: string;
}

/** What one article contributes to an event. Kept in score_breakdown so later sources can rescore. */
export interface SourceEvidence {
  articleId: number;
  outlet: string;
  tier: Tier;
  contentHash: string | null;
  certainty: number;
  evidenceType: EvidenceType;
  verbatim: boolean;
  speculative: boolean;
  plenary: boolean;
  quote: string;
}

export type SubjectClass = "DENIAL" | "REVERSAL" | "LEGAL_CHALLENGE";

export type Plan =
  | {
      kind: "event";
      extracted: ExtractedLegislator;
      match: MatchResult;
      fromParty: string | null;
      /** Null when not stated or not in the party register. */
      toParty: string | null;
      source: SourceEvidence;
    }
  | { kind: "subject"; classification: SubjectClass; extracted: ExtractedLegislator; match: MatchResult; toParty: string | null }
  | { kind: "group_remainder"; count: number; chamber: "senate" | "house" | "state_assembly" | null; toParty: string | null }
  | { kind: "dropped"; name: string; reason: string };

const partyCode = (p: string | null) => (p === null || p === OTHER_PARTY ? null : p);

function query(l: ExtractedLegislator) {
  return {
    name: l.name_as_written,
    chamber: l.chamber,
    state: l.state,
    constituency: l.constituency,
    fromParty: l.from_party,
  };
}

export function planArticle(output: ClassifierOutput, article: ArticleMeta, roster: RosterEntry[]): Plan[] {
  const c = output.classification;
  const plans: Plan[] = [];

  if (c === "DENIAL" || c === "REVERSAL" || c === "LEGAL_CHALLENGE") {
    for (const l of output.legislators) {
      plans.push({ kind: "subject", classification: c, extracted: l, match: matchLegislator(query(l), roster), toParty: partyCode(l.to_party) });
    }
    return plans;
  }
  if (!isPublishable(c)) return plans;

  const verbatim = verbatimFlags(output, article.text);
  output.legislators.forEach((l, i) => {
    const match = matchLegislator(query(l), roster);
    if (match.status === "FORMER") {
      plans.push({ kind: "dropped", name: l.name_as_written, reason: `matches former member ${match.legislator?.fullName}` });
      return;
    }
    plans.push({
      kind: "event",
      extracted: l,
      match,
      fromParty: partyCode(l.from_party),
      toParty: partyCode(l.to_party),
      source: {
        articleId: article.id,
        outlet: article.outlet,
        tier: article.tier,
        contentHash: article.contentHash,
        certainty: output.certainty,
        evidenceType: l.evidence_type,
        verbatim: verbatim[i],
        speculative: output.checks.speculative_language_present,
        plenary: output.checks.is_plenary_announcement || c === "FORMAL_PLENARY_ANNOUNCEMENT",
        quote: l.evidence_quote,
      },
    });
  });

  if (c === "GROUP_DEFECTION" && output.unnamed_count) {
    const named = output.legislators[0];
    plans.push({
      kind: "group_remainder",
      count: output.unnamed_count,
      chamber: named && named.chamber !== "unknown" ? named.chamber : null,
      toParty: named ? partyCode(named.to_party) : null,
    });
  }
  return plans;
}

export interface EventAssessment {
  breakdown: ScoreBreakdown;
  gates: string[];
  route: Route;
}

export function assessEvent(
  input: {
    sources: SourceEvidence[];
    match: MatchResult;
    /** Flags beyond the resolver's, e.g. `denied`. */
    extraFlags?: string[];
    toParty: string | null;
  },
  thresholds: Thresholds,
): EventAssessment {
  const { sources, match } = input;
  const unique = match.status === "UNIQUE";
  const breakdown = scoreEvent({
    // C comes from the most certain source; the others add corroboration.
    certainty: Math.max(...sources.map((s) => s.certainty)),
    entityScore: unique ? match.score : null,
    bestTier: Math.min(...sources.map((s) => s.tier)) as Tier,
    independentOutlets: independentOutlets(sources),
    evidence: sources.map((s) => ({ type: s.evidenceType, verbatim: s.verbatim })),
  });
  const gates = hardGates({
    flags: [...match.flags, ...(input.extraFlags ?? [])],
    toParty: input.toParty,
    // One clean report is enough to lift the speculation gate.
    speculative: sources.every((s) => s.speculative),
    isPlenary: sources.some((s) => s.plenary),
    anyQuoteVerbatim: sources.some((s) => s.verbatim),
  });
  return { breakdown, gates, route: routeEvent({ score: breakdown.score, gates, entityUnique: unique }, thresholds) };
}
