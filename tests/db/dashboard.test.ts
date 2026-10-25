import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARTY_COLORS } from "@/lib/parties";
import { createEvent, createSeededDb, publish, setDemoMode } from "./fixtures";
import { adminClaims, asRole, rows } from "./harness";

let db: PGliteInterface;
beforeEach(async () => {
  db = await createSeededDb();
  await setDemoMode(db, true);
});
afterEach(() => db.close());

/** Publishes a defection dated `date` (the seeded affiliations start 2023-06-13). */
async function defect(name: string, from: string, to: string, date: string) {
  const id = await createEvent(db, { name, from, to, date });
  await publish(db, id);
  return id;
}

const anon = <T>(sql: string, params: unknown[] = []) => asRole(db, "anon", (tx) => rows<T>(tx, sql, params));

describe("party colours", () => {
  it("match lib/parties.ts for every party", async () => {
    const stored = await rows<{ code: string; color: string | null }>(db, "select code, color from parties order by code");
    expect(Object.fromEntries(stored.map((p) => [p.code, p.color]))).toEqual(PARTY_COLORS);
  });
});

describe("dashboard aggregations", () => {
  beforeEach(async () => {
    await defect("Barnabas Okeyode", "PDP", "APC", "2026-09-14");
    await defect("Zainab Kurfi-Adamu", "NNPP", "APC", "2026-09-16");
    // Not published: must never be counted.
    await createEvent(db, { name: "Halima Dogo-Fictional", from: "LP", to: "APC", date: "2026-09-15", status: "in_review" });
  });

  it("counts published events only, with net gainers and losers", async () => {
    const [k] = await anon<Record<string, unknown>>("select * from public.defection_kpis()");
    expect(k).toMatchObject({ total: 2, top_gainer: "APC", top_gainer_net: 2, top_loser: "NNPP", top_loser_net: -1 });
  });

  it("applies the chamber, party, state and date filters", async () => {
    const count = async (...args: unknown[]) =>
      (await anon<{ n: number }>("select count(*)::int as n from public.dashboard_events($1, $2, $3, $4, $5)", args))[0].n;
    expect(await count(null, null, null, null, null)).toBe(2);
    expect(await count("senate", null, null, null, null)).toBe(1);
    expect(await count(null, "NNPP", null, null, null)).toBe(1);
    expect(await count(null, "LP", null, null, null)).toBe(0);
    expect(await count(null, "APC", null, null, null)).toBe(2);
    expect(await count(null, null, "Ondo", null, null)).toBe(1);
    expect(await count(null, null, null, "2026-09-15", null)).toBe(1);
    expect(await count(null, null, null, null, "2026-09-14")).toBe(1);
  });

  it("returns flows, per-state counts and weekly counts", async () => {
    expect(await anon("select from_code, to_code, defections::int from public.party_flows()")).toEqual([
      { from_code: "NNPP", to_code: "APC", defections: 1 },
      { from_code: "PDP", to_code: "APC", defections: 1 },
    ]);
    const states = await anon<{ state: string; defections: number; top_from: string; top_to: string }>(
      "select state, defections::int, top_from, top_to from public.defections_by_state()",
    );
    expect(states).toHaveLength(2);
    expect(states.find((s) => s.state === "Ondo")).toMatchObject({ defections: 1, top_from: "PDP", top_to: "APC" });

    const weeks = await anon<{ week_start: string; defections: number }>(
      "select week_start::text, defections::int from public.defections_by_week(null, null, null, '2026-09-07', '2026-09-27')",
    );
    expect(weeks).toEqual([
      { week_start: "2026-09-07", defections: 0 },
      { week_start: "2026-09-14", defections: 2 },
      { week_start: "2026-09-21", defections: 0 },
    ]);
  });

  it("does not count unpublished events for admins either", async () => {
    const [k] = await asRole(db, "authenticated", (tx) => rows<{ total: number }>(tx, "select total::int from public.defection_kpis()"), adminClaims);
    expect(k.total).toBe(2);
  });

  it("hides fictional defections from the public when demo mode is off", async () => {
    await setDemoMode(db, false);
    const [k] = await anon<{ total: number; top_gainer: string | null }>("select total::int, top_gainer from public.defection_kpis()");
    expect(k).toEqual({ total: 0, top_gainer: null });
    expect(await anon("select * from public.defections_by_week()")).toEqual([]);
  });
});
