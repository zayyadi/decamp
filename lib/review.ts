// Pure helpers for the admin area (Milestone 7), shared by server actions and
// tests.

export const REJECT_REASONS = [
  { value: "rumour", label: "Rumour or speculation" },
  { value: "denied", label: "Denied by the member" },
  { value: "wrong_person", label: "Wrong person" },
  { value: "not_legislator", label: "Not a sitting legislator" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other (explain in the note)" },
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number]["value"];

/** Where to go after signing in: only paths inside /admin, never another origin. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/admin") || next.startsWith("//") || next.includes("\\") || next.startsWith("/admin/login")) {
    return "/admin/review";
  }
  return next;
}

export interface ReviewFields {
  legislator_id: string | null;
  from_party: string | null;
  to_party: string | null;
  event_date: string | null;
}

/**
 * The `p_edits` for review_approve / review_edit: only fields the reviewer
 * changed. An empty select or date clears the field ("" → null), except the
 * member and destination, which can't be unset.
 */
export function buildEdits(original: ReviewFields, submitted: Partial<Record<keyof ReviewFields, string | null>>): Partial<ReviewFields> {
  const edits: Partial<ReviewFields> = {};
  const value = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim());

  const legislator = value(submitted.legislator_id);
  if (legislator && legislator !== original.legislator_id) edits.legislator_id = legislator;
  const from = value(submitted.from_party);
  if (from !== undefined && from !== original.from_party) edits.from_party = from;
  const to = value(submitted.to_party);
  if (to && to !== original.to_party) edits.to_party = to;
  const date = value(submitted.event_date);
  if (date !== undefined && date !== original.event_date) edits.event_date = date;
  return edits;
}

/**
 * Database refusals are written for reviewers already ("cannot publish: …");
 * strip Postgres framing and keep anything unexpected generic.
 */
export function reviewErrorMessage(message: string | undefined): string {
  const m = (message ?? "").trim();
  if (/not authorised|permission denied|JWT/i.test(m)) return "Your session can't do this. Sign in again as an admin.";
  if (/^(cannot publish|cannot merge|this event was already reviewed|a rejection reason|explain the rejection|nothing to change|unknown (destination )?party|unknown edit fields|legislator .* not found|an event cannot|target event|only published events|only the most recent|a correction note|no earlier affiliation)/i.test(m)) {
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  return "Something went wrong. Nothing was changed.";
}

/** "3m 12s"; a run with no finish time either is still going or crashed before closing its row. */
export function runDuration(r: { started_at: string; finished_at: string | null }): string {
  if (!r.finished_at) return "Running or crashed";
  const s = Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
