import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededDb } from "./fixtures";
import { adminClaims, asRole, one } from "./harness";

let db: PGliteInterface;
beforeEach(async () => { db = await createSeededDb(); });
afterEach(() => db.close());

describe("launch database audit", () => {
  it("reports missing real data while confirming RLS, admin policy and private article bodies", async () => {
    const { report } = await asRole(db, "service_role", (tx) => one<{ report: Record<string, unknown> }>(tx, "select launch_readiness() as report"));
    expect(report).toMatchObject({ demo_mode: false, real_members: 0, rls_disabled: [], article_content_exposed: false, missing_functions: [], admin_visibility_policy: true });
  });
  it("is inaccessible to visitors and editor sessions", async () => {
    for (const role of ["anon", "authenticated"] as const) await expect(asRole(db, role, (tx) => tx.query("select launch_readiness()"), adminClaims)).rejects.toThrow(/permission denied/);
  });
});
