import { z } from "zod";

// Classifier output (AGENT.md §4.2). The JSON schema sent to the model as a
// structured-output format is generated from this, so the two cannot drift.

export const CLASSES = [
  "CONFIRMED_DEFECTION",
  "FORMAL_PLENARY_ANNOUNCEMENT",
  "GROUP_DEFECTION",
  "INTENT_OR_RUMOUR",
  "DENIAL",
  "REVERSAL",
  "NON_LEGISLATOR_DEFECTION",
  "FORMER_LEGISLATOR",
  "LEGAL_CHALLENGE",
  "IRRELEVANT",
] as const;
export type Classification = (typeof CLASSES)[number];

/** Classes that can create a defection event. */
export const PUBLISHABLE: readonly Classification[] = [
  "CONFIRMED_DEFECTION",
  "FORMAL_PLENARY_ANNOUNCEMENT",
  "GROUP_DEFECTION",
];
/** Classes whose `legislators` name the subject, to attach to existing events. */
export const SUBJECT_CLASSES: readonly Classification[] = ["DENIAL", "REVERSAL", "LEGAL_CHALLENGE"];

export const isPublishable = (c: Classification) => PUBLISHABLE.includes(c);

export const EVIDENCE_TYPES = [
  "plenary_letter",
  "legislator_direct_quote",
  "reported_completed_act",
  "vague",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

const isoDate = (description: string) => z.iso.date().describe(description);

export const OTHER_PARTY = "OTHER";

/** Built per run because the allowed party codes come from the `parties` table. */
export function classifierOutputSchema(partyCodes: readonly string[]) {
  const party = z
    .enum([OTHER_PARTY, ...partyCodes])
    .nullable()
    .describe("Party code from the allowed list, OTHER, or null if the article does not state it");

  const legislator = z.object({
    name_as_written: z.string().min(1),
    chamber: z.enum(["senate", "house", "state_assembly", "unknown"]),
    state: z.string().nullable(),
    constituency: z.string().nullable(),
    from_party: party,
    to_party: party,
    party_name_as_written: z
      .string()
      .nullable()
      .describe("The party's name as written; required when from_party or to_party is OTHER"),
    event_date: isoDate(
      "YYYY-MM-DD of the act itself; resolve relative dates against the publication date",
    ).nullable(),
    date_basis: z.enum(["explicit", "relative_resolved", "publication_fallback", "unknown"]),
    is_return: z.boolean(),
    reason_given: z.string().nullable(),
    evidence_type: z
      .enum(EVIDENCE_TYPES)
      .describe(
        "plenary_letter: a presiding officer read the letter; legislator_direct_quote: the legislator's own words; reported_completed_act: the journalist reports the completed act; vague: anything weaker",
      ),
    evidence_quote: z
      .string()
      .min(1)
      .max(300)
      .describe("Verbatim span from the article, at most 300 characters, proving the act"),
  });

  return z.object({
    checks: z
      .object({
        subjects: z
          .array(z.string())
          .describe("Every person said to be defecting or rumoured to defect, as written"),
        subject_roles: z
          .array(
            z.enum([
              "sitting_senator",
              "sitting_rep",
              "state_legislator",
              "former_legislator",
              "governor",
              "other_official",
              "unknown",
            ]),
          )
          .describe("Role per subject, in the same order as subjects"),
        act_status: z.enum([
          "completed",
          "intent_or_rumour",
          "denied",
          "rescinded",
          "legal_dispute",
          "historical_mention",
          "none",
        ]),
        speculative_language_present: z.boolean(),
        is_plenary_announcement: z.boolean(),
        publication_date_used: isoDate("YYYY-MM-DD, as provided in the input"),
      })
      .describe("Fill these FIRST, in order. They are your step-by-step reasoning."),
    classification: z.enum(CLASSES),
    certainty: z.number().min(0).max(1),
    legislators: z
      .array(legislator)
      .describe(
        "Only legislators whose defection is COMPLETED; for DENIAL, REVERSAL and LEGAL_CHALLENGE, the subject",
      ),
    unnamed_count: z.number().int().min(0).nullable().describe("Members said to defect but not named"),
    mentioned_not_defected: z.array(z.string()),
    reasoning_summary: z.string().describe("At most 60 words, plain English"),
  });
}

export type ClassifierOutput = z.infer<ReturnType<typeof classifierOutputSchema>>;
export type ExtractedLegislator = ClassifierOutput["legislators"][number];

/**
 * Rules the JSON schema cannot express. A violation is treated like a schema
 * failure: one retry with the problems listed, then ERROR (AGENT.md §4.2).
 */
export function consistencyIssues(output: ClassifierOutput): string[] {
  const issues: string[] = [];
  const { classification: c, legislators } = output;

  if ((c === "CONFIRMED_DEFECTION" || c === "FORMAL_PLENARY_ANNOUNCEMENT") && legislators.length === 0) {
    issues.push(`${c} needs at least one legislator`);
  }
  if (c === "GROUP_DEFECTION" && legislators.length === 0 && !output.unnamed_count) {
    issues.push("GROUP_DEFECTION needs named legislators or an unnamed_count");
  }
  if (!isPublishable(c) && !SUBJECT_CLASSES.includes(c) && legislators.length > 0) {
    issues.push(`${c} must have an empty legislators list`);
  }
  if (output.checks.subjects.length !== output.checks.subject_roles.length) {
    issues.push("checks.subject_roles must have one role per subject");
  }
  legislators.forEach((l, i) => {
    const usesOther = l.from_party === OTHER_PARTY || l.to_party === OTHER_PARTY;
    if (usesOther && !l.party_name_as_written) {
      issues.push(`legislators[${i}]: party_name_as_written is required when a party is OTHER`);
    }
  });
  return issues;
}
