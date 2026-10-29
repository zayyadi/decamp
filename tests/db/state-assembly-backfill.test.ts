import type { PGliteInterface } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicalKey, parseHistoricalEvents } from "@/scripts/lib/historical-events";
import { createSeededDb } from "./fixtures";
import { adminClaims, asRole, one, rows } from "./harness";

let db: PGliteInterface;
beforeEach(async () => { db = await createSeededDb(); });
afterEach(() => db.close());

// Fictional test identities; source is deliberately not a news claim.
const first = {
  full_name: "Assembly Test Member", chamber: "state_assembly", state: "Kano", constituency: "Test Ward",
  elected_party: "NNPP", term_start: "2023-06-13", from_party: "NNPP", to_party: "APC", event_date: "2024-03-05",
  source_url: "https://example.org/assembly-backfill-test", source_title: "Test proceeding", outlet: "test",
  published_at: "2024-03-05T12:00:00Z", evidence_quote: "A fictional assembly member changes party.", verified_at: "2026-10-28",
};
const prepare = (data: unknown) => parseHistoricalEvents(data, "2026-10-29").map((e) => ({ ...e, dedupe_key: historicalKey(e) }));
type Result = { drafted: number; skipped: number; linked: number; departed: number };
const draft = async (data: unknown) => (await asRole(db, "service_role", (tx) => one<{ result: Result }>(tx,
  "select draft_historical_events($1::jsonb) as result", [JSON.stringify(data)]))).result;
const asAdmin = <T>(sql: string, params: unknown[] = []) =>
  asRole(db, "authenticated", (tx) => rows<T>(tx, sql, params), adminClaims);
const count = async (sql: string) => (await one<{ n: number }>(db, `select count(*)::int as n from ${sql}`)).n;
const drafts = () => rows<{ id: string; legislator_id: string | null; status: string }>(db,
  "select id, legislator_id, status from defection_events where model = 'historical-import' order by event_date");

/** What an editor does with a draft: add the member from its proposed details, then approve. */
async function addAndApprove(eventId: string) {
  const { proposed_member: m, state } = await one<{ proposed_member: Record<string, string>; state: string }>(db,
    "select proposed_member, state from defection_events where id = $1", [eventId]);
  await asAdmin("select review_add_member($1, $2, $3, $4, $5, $6, $7)",
    [eventId, m.full_name, state, m.constituency, m.elected_party, m.term_start, m.source_url]);
  await asAdmin("select review_approve($1)", [eventId]);
}

describe("state-assembly backfill", () => {
  it("drafts the researched dataset into review without publishing anything, and replays safely", async () => {
    const plan = prepare(JSON.parse(readFileSync(new URL("../../supabase/seed/state-assembly.historical.json", import.meta.url), "utf8")));
    expect(await draft(plan)).toEqual({ drafted: plan.length, skipped: 0, linked: 0, departed: 0 });
    expect(await draft(plan)).toEqual({ drafted: 0, skipped: plan.length, linked: 0, departed: 0 });
    expect(await count("defection_events where status = 'in_review' and legislator_id is null and chamber = 'state_assembly'")).toBe(plan.length);
    expect(await count("event_sources")).toBe(plan.length);
    expect(await count("alerts")).toBe(0);
    expect(await count("legislators where not is_fictional")).toBe(0);
  });

  it("keeps drafts and proposed member details away from the public", async () => {
    await draft(prepare([first]));
    await expect(asRole(db, "anon", (tx) => tx.query("select proposed_member from defection_events"))).rejects.toThrow(/permission denied/);
    expect(await asRole(db, "anon", (tx) => rows(tx, "select id from defection_events"))).toEqual([]);
    const [admin] = await asAdmin<{ review_flags: string[]; name: string }>(
      "select review_flags, proposed_member ->> 'full_name' as name from defection_events");
    expect(admin).toEqual({ review_flags: ["historical_backfill"], name: "Assembly Test Member" });
  });

  it("publishes through review, dates the alert historically and links the member's next event on a rerun", async () => {
    const plan = prepare([first, { ...first, from_party: "APC", to_party: "ADC", event_date: "2025-11-20" }]);
    expect(await draft(plan)).toMatchObject({ drafted: 2, linked: 0 });
    const [earlier, later] = await drafts();
    await addAndApprove(earlier.id);
    expect(await one(db, "select created_at::date::text as day from alerts where event_id = $1", [earlier.id])).toEqual({ day: "2024-03-05" });

    expect(await draft(plan)).toEqual({ drafted: 0, skipped: 2, linked: 1, departed: 0 });
    const [, linked] = await drafts();
    expect(linked.legislator_id).not.toBeNull();
    await asAdmin("select review_approve($1)", [later.id]);
    expect(await one(db, "select p.code from legislators l join parties p on p.id = l.current_party_id where not l.is_fictional"))
      .toEqual({ code: "ADC" });
  });

  it("records a departure only after the defection before it is approved", async () => {
    const plan = prepare([{ ...first, status: "vacated", left_office_on: "2024-04-01" }]);
    expect(await draft(plan)).toMatchObject({ drafted: 1, departed: 0 });
    const [event] = await drafts();
    await addAndApprove(event.id);
    expect(await draft(plan)).toMatchObject({ departed: 1 });
    expect(await draft(plan)).toMatchObject({ departed: 0 });
    expect(await one(db, "select status from legislators where not is_fictional")).toEqual({ status: "vacated" });
    expect(await count("party_affiliations a join legislators l on l.id = a.legislator_id where not l.is_fictional and a.end_date is null")).toBe(0);
  });

  it("refuses federal rows, the FCT and unknown parties, writing nothing", async () => {
    const federal = prepare([{ ...first, chamber: "house" }]);
    await expect(draft(federal)).rejects.toThrow(/only state-assembly events/);
    const fct = prepare([first]).map((e) => ({ ...e, state: "FCT" }));
    await expect(draft(fct)).rejects.toThrow(/no House of Assembly/);
    const unknown = prepare([first, { ...first, from_party: "APC", to_party: "ZZZ", event_date: "2025-01-01" }]);
    await expect(draft(unknown)).rejects.toThrow(/unknown party/);
    expect(await count("defection_events")).toBe(0);
    expect(await count("articles")).toBe(0);
  });

  it("is refused to anon and to admin sessions", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(asRole(db, role, (tx) => tx.query("select draft_historical_events($1::jsonb)", [JSON.stringify(prepare([first]))]), adminClaims))
        .rejects.toThrow(/permission denied/);
    }
  });
});
