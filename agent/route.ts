// Routing (AGENT.md §6.3, §6.5). Thresholds come from env via the caller.

export interface Thresholds {
  publish: number;
  review: number;
}

export const REJECT_BELOW = 0.3;

export interface GateInput {
  /** Resolver and corroboration flags (ambiguous_entity, denied, …). */
  flags: string[];
  toParty: string | null;
  speculative: boolean;
  isPlenary: boolean;
  anyQuoteVerbatim: boolean;
}

const GATING_FLAGS = new Set(["ambiguous_entity", "unresolved_entity", "party_mismatch", "denied", "state_assembly"]);

/** Every hard gate that fires. Any one sends the event to review. */
export function hardGates(input: GateInput): string[] {
  const gates = input.flags.filter((f) => GATING_FLAGS.has(f));
  if (!input.anyQuoteVerbatim) gates.push("quote_not_verbatim");
  if (input.toParty === null) gates.push("to_party_missing");
  if (input.speculative && !input.isPlenary) gates.push("speculative_language");
  return [...new Set(gates)];
}

export interface Route {
  status: "published" | "in_review" | "rejected";
  /** Insert an unverified "developing" alert. Published events get a confirmed one from publish_defection. */
  unverifiedAlert: boolean;
}

export function routeEvent(
  input: { score: number; gates: string[]; entityUnique: boolean },
  thresholds: Thresholds,
): Route {
  const { score, gates, entityUnique } = input;
  if (gates.length === 0 && score >= thresholds.publish) return { status: "published", unverifiedAlert: false };
  if (score < REJECT_BELOW) return { status: "rejected", unverifiedAlert: false };
  return { status: "in_review", unverifiedAlert: score >= thresholds.review && entityUnique };
}
