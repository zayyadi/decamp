import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planDemoEvents, type DemoLegislator } from "@/scripts/lib/demo-events";
import { createSeededDb, setDemoMode } from "./fixtures";
import { adminClaims, asRole, one, rows } from "./harness";

let db: PGliteInterface;
beforeEach(async () => {
  db = await createSeededDb();
});
afterEach(() => db.close());

const roster = () =>
  rows<DemoLegislator>(
    db,
    `select l.full_name as "fullName", l.chamber, l.state, p.code as party, pa.start_date::text as since
     from legislators l
     join parties p on p.id = l.current_party_id
     join party_affiliations pa on pa.legislator_id = l.id and pa.end_date is null
     where l.is_fictional and l.status = 'sitting'`,
  );

const seed = async (events: unknown) =>
  asRole(db, "service_role", (tx) =>
    one<{ result: { inserted: number; published: number; skipped: number } }>(
      tx,
      "select public.seed_demo_events($1::jsonb) as result",
      [JSON.stringify(events)],
    ),
  ).then((r) => r.result);

describe("seed_demo_events", () => {
  it("publishes the planned defections and raises developing alerts for the rest", async () => {
    const plan = planDemoEvents(await roster(), { today: "2026-10-25", published: 6, inReview: 2 });
    expect(await seed(plan)).toEqual({ inserted: 8, published: 6, skipped: 0 });

    const statuses = await rows<{ status: string; n: number }>(
      db,
      "select status, count(*)::int as n from defection_events group by status order by status",
    );
    expect(statuses).toEqual([
      { status: "in_review", n: 2 },
      { status: "published", n: 6 },
    ]);
    const alerts = await rows<{ level: string; n: number; fictional: boolean }>(
      db,
      "select level, count(*)::int as n, bool_and(is_fictional) as fictional from alerts group by level order by level",
    );
    expect(alerts).toEqual([
      { level: "confirmed", n: 6, fictional: true },
      { level: "unverified", n: 2, fictional: true },
    ]);
    const moved = await one<{ n: number }>(
      db,
      `select count(*)::int as n from legislators l join parties p on p.id = l.current_party_id
       where l.full_name = any($1) and p.code = any($2)`,
      [plan.slice(0, 6).map((e) => e.full_name), [...new Set(plan.slice(0, 6).map((e) => e.to_party))]],
    );
    expect(moved.n).toBe(6);
    expect((await one<{ n: number }>(db, "select count(*)::int as n from event_sources")).n).toBe(8);
  });

  it("adds nothing when run again", async () => {
    const plan = planDemoEvents(await roster(), { today: "2026-10-25", published: 4, inReview: 1 });
    await seed(plan);
    expect(await seed(plan)).toEqual({ inserted: 0, published: 0, skipped: 5 });
    expect((await one<{ n: number }>(db, "select count(*)::int as n from alerts")).n).toBe(5);
  });

  it("plans no one new on a re-run, though the first run moved members and their dates", async () => {
    const today = "2026-10-25";
    // A one-day window makes every first-run event yesterday, the case that once pulled in extra members.
    await seed(planDemoEvents(await roster(), { today, published: 5, inReview: 2, days: 1 }));
    const keys = await rows<{ dedupe_key: string }>(db, "select dedupe_key from defection_events");
    const existing = new Set(keys.map((k) => k.dedupe_key));
    expect(planDemoEvents(await roster(), { today, published: 5, inReview: 2, days: 1, existing })).toEqual([]);
  });

  it("refuses a legislator who is not on the fictional roster, writing nothing", async () => {
    const [first] = planDemoEvents(await roster(), { today: "2026-10-25", published: 1, inReview: 0 });
    await expect(seed([first, { ...first, full_name: "Nobody Here", dedupe_key: "demo:x" }])).rejects.toThrow(
      /no sitting fictional legislator/,
    );
    expect((await one<{ n: number }>(db, "select count(*)::int as n from defection_events")).n).toBe(0);
  });

  it("is visible to the public only in demo mode", async () => {
    await seed(planDemoEvents(await roster(), { today: "2026-10-25", published: 3, inReview: 1 }));
    const publicCount = () =>
      asRole(db, "anon", (tx) => one<{ n: number }>(tx, "select total::int as n from public.defection_kpis()"));
    expect((await publicCount()).n).toBe(0);
    await setDemoMode(db, true);
    expect((await publicCount()).n).toBe(3);
  });

  it("is not callable by anon or signed-in users", async () => {
    await expect(asRole(db, "anon", (tx) => tx.query("select public.seed_demo_events('[]')"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("select public.seed_demo_events('[]')"), adminClaims),
    ).rejects.toThrow(/permission denied/);
  });
});
