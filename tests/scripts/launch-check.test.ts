import { describe, expect, it } from "vitest";
import { assessDatabase, assessEvidence, EVIDENCE_IDS } from "@/scripts/lib/launch-check";

const db = { demo_mode: false, real_members: 59, sitting_senators: 20, sitting_representatives: 38,
  missing_provenance: 0, rls_disabled: [], article_content_exposed: false, missing_functions: [], admin_visibility_policy: true };

describe("launch readiness", () => {
  it("blocks exposed data, demo mode and missing migrations", () => {
    const checks = assessDatabase({ ...db, demo_mode: true, rls_disabled: ["articles"], article_content_exposed: true, missing_functions: ["review_approve"], admin_visibility_policy: false });
    for (const id of ["demo_off", "rls", "article_privacy", "migrations"]) expect(checks.find((c) => c.id === id)?.passed).toBe(false);
  });
  it("never treats sourced member counts as proof of a complete reviewed roster", () => {
    expect(assessDatabase(db).find((c) => c.id === "real_roster")?.passed).toBe(true);
    expect(assessEvidence({}).find((c) => c.id === "roster_review")?.passed).toBe(false);
  });
  it("requires dated evidence rather than an unchecked success flag", () => {
    expect(assessEvidence({ api_eval: { passed: true, evidence: "", verified_at: null } }).every((c) => !c.passed)).toBe(true);
    const verified = Object.fromEntries(EVIDENCE_IDS.map((id) => [id, { passed: true, evidence: "Verified evidence reference", verified_at: "2026-10-25" }]));
    expect(assessEvidence(verified).every((c) => c.passed)).toBe(true);
  });
});
