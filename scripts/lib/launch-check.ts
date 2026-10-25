import { z } from "zod";

export const readinessSchema = z.object({
  demo_mode: z.boolean(), real_members: z.number().int().nonnegative(),
  sitting_senators: z.number().int().nonnegative(), sitting_representatives: z.number().int().nonnegative(),
  missing_provenance: z.number().int().nonnegative(), rls_disabled: z.array(z.string()),
  article_content_exposed: z.boolean(), missing_functions: z.array(z.string()), admin_visibility_policy: z.boolean(),
});
export const EVIDENCE_IDS = ["roster_review", "auth_review", "api_eval", "agent_72h_dry_run", "publisher_terms", "backup_restore", "cost_review"] as const;
export const evidenceSchema = z.record(z.string(), z.object({
  passed: z.boolean(), evidence: z.string(), verified_at: z.iso.date().nullable(),
}));
export type LaunchCheck = { id: string; passed: boolean; detail: string };

export function assessDatabase(data: z.infer<typeof readinessSchema>): LaunchCheck[] {
  return [
    { id: "demo_off", passed: !data.demo_mode, detail: "Fictional records must be hidden in production." },
    { id: "real_roster", passed: data.real_members > 0 && data.missing_provenance === 0, detail: `${data.real_members} sourced real members; ${data.sitting_senators} sitting senators and ${data.sitting_representatives} representatives. Counts alone do not prove a complete roster.` },
    { id: "rls", passed: data.rls_disabled.length === 0, detail: data.rls_disabled.length ? `RLS absent: ${data.rls_disabled.join(", ")}` : "RLS enabled on every application table." },
    { id: "article_privacy", passed: !data.article_content_exposed, detail: "Article bodies must be inaccessible to anonymous and authenticated API roles." },
    { id: "migrations", passed: data.missing_functions.length === 0 && data.admin_visibility_policy, detail: data.missing_functions.length ? `Missing functions: ${data.missing_functions.join(", ")}` : data.admin_visibility_policy ? "Required import/review functions and admin visibility policy exist." : "Admin legislator visibility migration is missing." },
  ];
}

export function assessEvidence(input: unknown): LaunchCheck[] {
  const evidence = evidenceSchema.parse(input);
  return EVIDENCE_IDS.map((id) => {
    const entry = evidence[id];
    return { id, passed: Boolean(entry?.passed && entry.evidence.trim() && entry.verified_at), detail: entry?.evidence.trim() || "Verification evidence has not been recorded." };
  });
}
