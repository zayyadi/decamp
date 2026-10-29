import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSource, createEvent, createSeededDb, publish, setDemoMode } from "./fixtures";
import { adminClaims, asRole, rows, userClaims } from "./harness";

let db: PGliteInterface;
beforeEach(async () => {
  db = await createSeededDb();
});
afterEach(() => db.close());

const asAnon = <T>(sql: string, params: unknown[] = []) =>
  asRole(db, "anon", (tx) => rows<T>(tx, sql, params));

async function publishedAndPendingEvents() {
  const published = await createEvent(db, {
    name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-09-14",
  });
  await addSource(db, published, "https://example.org/published");
  await publish(db, published);

  const pending = await createEvent(db, {
    name: "Zainab Kurfi-Adamu", from: "NNPP", to: "APC", status: "in_review",
  });
  await addSource(db, pending, "https://example.org/pending");
  return { published, pending };
}

describe("fictional rows", () => {
  it("admins can join published events to their legislators and affiliations with demo mode off", async () => {
    const { published } = await publishedAndPendingEvents();
    const result = await asRole(db, "authenticated", (tx) => rows(tx, `
      select e.id, l.id as legislator, pa.id as affiliation
      from defection_events e
      left join legislators l on l.id = e.legislator_id
      left join party_affiliations pa on pa.defection_event_id = e.id
      where e.status = 'published'
    `), adminClaims);
    expect(result).toEqual([{ id: published, legislator: expect.any(String), affiliation: expect.any(Number) }]);
    expect(await asRole(db, "authenticated", (tx) => rows(tx, "select id from legislators"), userClaims)).toEqual([]);
  });

  it("are hidden from the public while demo mode is off", async () => {
    await publishedAndPendingEvents();
    expect(await asAnon("select id from legislators")).toEqual([]);
    expect(await asAnon("select id from party_affiliations")).toEqual([]);
    expect(await asAnon("select id from alerts")).toEqual([]);
    expect(await asAnon("select id from defection_events")).toEqual([]);
  });

  it("are visible once demo mode is on", async () => {
    await publishedAndPendingEvents();
    await setDemoMode(db, true);
    expect((await asAnon("select id from legislators")).length).toBe(65);
    expect((await asAnon("select id from alerts")).length).toBe(1);
  });
});

describe("with demo mode on", () => {
  beforeEach(async () => {
    await setDemoMode(db, true);
  });

  it("anon sees published events only", async () => {
    const { published } = await publishedAndPendingEvents();
    expect(await asAnon<{ id: string }>("select id from defection_events")).toEqual([
      { id: published },
    ]);
  });

  it("anon sees sources and article metadata only for published events", async () => {
    await publishedAndPendingEvents();
    expect(await asAnon("select url, outlet, title from articles")).toEqual([
      { url: "https://example.org/published", outlet: "demo-outlet", title: "Demo headline" },
    ]);
    expect((await asAnon("select article_id from event_sources")).length).toBe(1);
  });

  it("never exposes article bodies or internal article columns", async () => {
    await publishedAndPendingEvents();
    await expect(asAnon("select content from articles")).rejects.toThrow(/permission denied/);
    await expect(asAnon("select * from articles")).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, "authenticated", (tx) => rows(tx, "select content from articles"), adminClaims),
    ).rejects.toThrow(/permission denied/);
  });

  it("hides reviewer details from anon", async () => {
    await publishedAndPendingEvents();
    await expect(asAnon("select reviewed_by from defection_events")).rejects.toThrow(
      /permission denied/,
    );
    await expect(asAnon("select proposed_member from defection_events")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("admins see every event; ordinary users see published ones", async () => {
    await publishedAndPendingEvents();
    const count = async (claims: object) =>
      (await asRole(db, "authenticated", (tx) => rows(tx, "select id from defection_events"), claims)).length;
    expect(await count(adminClaims)).toBe(2);
    expect(await count(userClaims)).toBe(1);
  });

  it("restricts agent runs and review feedback to admins", async () => {
    await db.query("insert into agent_runs default values");
    const read = (claims: object) =>
      asRole(db, "authenticated", (tx) => rows(tx, "select id from agent_runs"), claims);
    expect(await read(userClaims)).toEqual([]);
    expect((await read(adminClaims)).length).toBe(1);
    await expect(asAnon("select id from agent_runs")).rejects.toThrow(/permission denied/);
    await expect(asAnon("select id from review_feedback")).rejects.toThrow(/permission denied/);
  });
});

describe("writes", () => {
  it.each([
    ["insert", "insert into parties (code, name) values ('ZZZ', 'Test Party')"],
    ["update", "update legislators set full_name = 'x'"],
    ["delete", "delete from alerts"],
    ["truncate", "truncate alerts"],
    ["settings", "update app_settings set demo_mode = true"],
  ])("are denied to anon (%s)", async (_label, sql) => {
    await expect(asRole(db, "anon", (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
  });

  it("are denied to signed-in users, admins included", async () => {
    for (const claims of [userClaims, adminClaims]) {
      await expect(
        asRole(db, "authenticated", (tx) => tx.query("update legislators set full_name = 'x'"), claims),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it.each([
    ["seed_roster", "select public.seed_roster('[]'::jsonb, true)"],
    ["set_demo_mode", "select public.set_demo_mode(true)"],
    ["seed_demo_events", "select public.seed_demo_events('[]'::jsonb)"],
    ["reverse_defection", "select public.reverse_defection(gen_random_uuid(), 'x')"],
  ])("restricted function %s is not callable by anon", async (_label, sql) => {
    await expect(asRole(db, "anon", (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
  });

  it("seed functions are not callable by signed-in users", async () => {
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("select public.set_demo_mode(true)"), adminClaims),
    ).rejects.toThrow(/permission denied/);
  });
});
