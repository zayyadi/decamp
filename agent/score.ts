import type { EvidenceType } from "./classify/schema";
import type { Tier } from "./sources";

// Confidence score (AGENT.md §6.2):
//   score = 0.35·C + 0.20·E + 0.20·T + 0.15·K + 0.10·V

const TIER_FACTOR: Record<Tier, number> = { 1: 1.0, 2: 0.7, 3: 0.4 };

const EVIDENCE_FACTOR: Record<EvidenceType, number> = {
  plenary_letter: 1.0,
  legislator_direct_quote: 1.0,
  reported_completed_act: 0.7,
  vague: 0.3,
};
const NOT_VERBATIM_CAP = 0.3;

export function corroborationFactor(independentOutlets: number): number {
  if (independentOutlets >= 3) return 1.0;
  return independentOutlets === 2 ? 0.8 : 0.3;
}

export interface EvidenceInput {
  type: EvidenceType;
  verbatim: boolean;
}

export const evidenceFactor = ({ type, verbatim }: EvidenceInput) =>
  verbatim ? EVIDENCE_FACTOR[type] : Math.min(EVIDENCE_FACTOR[type], NOT_VERBATIM_CAP);

export interface ScoreInput {
  certainty: number;
  /** Resolver score, or null when the match is not UNIQUE. */
  entityScore: number | null;
  bestTier: Tier;
  independentOutlets: number;
  /** One entry per source; the strongest counts. */
  evidence: EvidenceInput[];
}

export interface ScoreBreakdown {
  C: number;
  E: number;
  T: number;
  K: number;
  V: number;
  score: number;
}

/**
 * Half-up to 3 places, the precision of `defection_events.confidence`. The
 * products carry float noise (0.9525 arrives as 0.95249…), so round to 12
 * significant digits first.
 */
export function roundScore(x: number): number {
  return Math.round(Number((x * 1000).toPrecision(12))) / 1000;
}

export function scoreEvent(input: ScoreInput): ScoreBreakdown {
  const C = input.certainty;
  const E = input.entityScore ?? 0;
  const T = TIER_FACTOR[input.bestTier];
  const K = corroborationFactor(input.independentOutlets);
  const V = Math.max(0, ...input.evidence.map(evidenceFactor));
  const score = roundScore(0.35 * C + 0.2 * E + 0.2 * T + 0.15 * K + 0.1 * V);
  return { C, E, T, K, V, score };
}
