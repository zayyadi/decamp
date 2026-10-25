import type { Classification } from "./schema";

// Few-shot examples (AGENT.md §4.5). Every person here is FICTIONAL; never put
// a real legislator in an example (CLAUDE.md rule 2). Editing anything here is
// a prompt change: bump PROMPT_VERSION and run the eval.

export interface FewShotExample {
  id: number;
  classification: Classification;
  published: string;
  article: string;
  analysis: string;
}

export const examples: FewShotExample[] = [
  {
    id: 1,
    classification: "CONFIRMED_DEFECTION",
    published: "2026-09-15",
    article:
      "Senator Barnabas Okeyode, representing Ondo Central, on Monday formally joined the All Progressives Congress at a rally in Akure, three days after resigning from the Peoples Democratic Party. 'I have today joined the APC to better serve my people,' Okeyode said.",
    analysis: `checks: subjects ["Barnabas Okeyode"], roles ["sitting_senator"], act_status "completed",
  speculative false, plenary false. classification CONFIRMED_DEFECTION, certainty 0.95.
  legislators: [{name_as_written "Senator Barnabas Okeyode", chamber "senate", state "Ondo",
  constituency "Ondo Central", from_party "PDP", to_party "APC", event_date "2026-09-14",
  date_basis "relative_resolved", is_return false, evidence_type "legislator_direct_quote",
  evidence_quote "'I have today joined the APC to better serve my people,' Okeyode said."}]`,
  },
  {
    id: 2,
    classification: "FORMAL_PLENARY_ANNOUNCEMENT",
    published: "2026-07-09",
    article:
      "At Wednesday's plenary, the Speaker read a letter from Hon. Zainab Kurfi-Adamu (Malumfashi-Fictional Federal Constituency, Katsina), who announced her defection from the NNPP to the APC, citing the crisis rocking her former party.",
    analysis: `roles ["sitting_rep"], act_status "completed", plenary true. classification
  FORMAL_PLENARY_ANNOUNCEMENT, certainty 0.97. from NNPP, to APC, event_date "2026-07-08",
  evidence_type "plenary_letter", reason_given "crisis in former party".`,
  },
  {
    id: 3,
    classification: "GROUP_DEFECTION",
    published: "2026-05-21",
    article:
      "Five members of the House of Representatives from Rivers on Tuesday defected from the PDP to the APC. They include Hon. Ekpenyong Bassey-Ita, Hon. Tamuno Briggs-Fictional and Hon. Ngozi Amadi-Okafor. The letter was read by the Speaker.",
    analysis: `classification GROUP_DEFECTION, certainty 0.93. legislators: the three named reps (house, Rivers,
  PDP→APC, event_date "2026-05-19", evidence_type "plenary_letter"). unnamed_count 2. Plenary true.`,
  },
  {
    id: 4,
    classification: "INTENT_OR_RUMOUR",
    published: "2026-08-02",
    article:
      "Strong indications emerged on Sunday that Senator Halima Dogo-Fictional is set to dump the Labour Party for the ADC. Sources close to the senator said consultations are ongoing.",
    analysis: `act_status "intent_or_rumour", speculative true. classification INTENT_OR_RUMOUR, certainty 0.9,
  legislators [].`,
  },
  {
    id: 5,
    classification: "DENIAL",
    published: "2026-08-04",
    article:
      "The media aide to Senator Halima Dogo-Fictional has dismissed reports that the senator has left the Labour Party, describing them as 'the handiwork of mischief makers.'",
    analysis: `act_status "denied". classification DENIAL, certainty 0.92. legislators: [{name_as_written "Senator
  Halima Dogo-Fictional", chamber "senate", from_party "LP", to_party null, evidence_type "vague",
  evidence_quote "dismissed reports that the senator has left the Labour Party"}].`,
  },
  {
    id: 6,
    classification: "NON_LEGISLATOR_DEFECTION",
    published: "2026-06-11",
    article:
      "Governor Ayo Fadipe-Fictional on Thursday defected to the APC alongside his commissioners. Several federal lawmakers from the state are expected to follow suit.",
    analysis: `roles ["governor"]. act_status "completed" for the governor; lawmakers are speculative. classification
  NON_LEGISLATOR_DEFECTION, certainty 0.94, legislators [], mentioned_not_defected [].`,
  },
  {
    id: 7,
    classification: "FORMER_LEGISLATOR",
    published: "2026-04-30",
    article:
      "A former senator who represented Kogi East between 2015 and 2019, Sen. Idris Ocheja-Fictional, has joined the SDP.",
    analysis: `roles ["former_legislator"]. classification FORMER_LEGISLATOR, certainty 0.95, legislators [].`,
  },
  {
    id: 8,
    classification: "LEGAL_CHALLENGE",
    published: "2026-10-02",
    article:
      "The PDP has approached the Federal High Court seeking an order declaring vacant the seat of Senator Barnabas Okeyode, who defected to the APC, in line with Section 68(1)(g) of the Constitution.",
    analysis: `act_status "legal_dispute". classification LEGAL_CHALLENGE, certainty 0.93. legislators: the
  subject, with from_party "PDP", to_party "APC" and a quote proving the suit.`,
  },
  {
    id: 9,
    classification: "IRRELEVANT",
    published: "2026-09-20",
    article:
      "Senator Barnabas Okeyode, who defected to the APC last year, on Thursday sponsored a bill on coastal erosion.",
    analysis: `act_status "historical_mention". classification IRRELEVANT, certainty 0.9, legislators [].`,
  },
];

export function renderExamples(list: FewShotExample[] = examples): string {
  return list
    .map(
      (e) =>
        `<example id="${e.id}" class="${e.classification}">\nPublished ${e.published}. "${e.article}"\n→ ${e.analysis}\n</example>`,
    )
    .join("\n\n");
}
