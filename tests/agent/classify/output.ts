import type { ClassifierOutput, ExtractedLegislator } from "@/agent/classify/schema";

// Builders for classifier outputs in tests. Fictional people only.

export function legislator(over: Partial<ExtractedLegislator> = {}): ExtractedLegislator {
  return {
    name_as_written: "Senator Barnabas Okeyode",
    chamber: "senate",
    state: "Ondo",
    constituency: "Ondo Demo District 1",
    from_party: "PDP",
    to_party: "APC",
    party_name_as_written: null,
    event_date: "2026-09-14",
    date_basis: "relative_resolved",
    is_return: false,
    reason_given: null,
    evidence_type: "legislator_direct_quote",
    evidence_quote: "I have today joined the APC",
    ...over,
  };
}

export function output(over: Partial<ClassifierOutput> = {}): ClassifierOutput {
  return {
    checks: {
      subjects: ["Barnabas Okeyode"],
      subject_roles: ["sitting_senator"],
      act_status: "completed",
      speculative_language_present: false,
      is_plenary_announcement: false,
      publication_date_used: "2026-09-15",
    },
    classification: "CONFIRMED_DEFECTION",
    certainty: 0.95,
    legislators: [legislator()],
    unnamed_count: null,
    mentioned_not_defected: [],
    reasoning_summary: "The senator says he has joined the APC.",
    ...over,
  };
}

export const ARTICLE_TEXT =
  "Okeyode joins APC\nSenator Barnabas Okeyode, who represents Ondo Demo District 1, on Monday joined the APC. “I have today joined the APC,” he said.";
