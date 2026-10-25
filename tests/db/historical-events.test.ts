import type { PGliteInterface } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicalKey, parseHistoricalEvents } from "@/scripts/lib/historical-events";
import { createSeededDb } from "./fixtures";
import { adminClaims, asRole, one } from "./harness";

let db: PGliteInterface;
beforeEach(async () => { db = await createSeededDb(); });
afterEach(() => db.close());

// Fictional test identities; source is deliberately not a news claim.
const first = {
  full_name: "Historical Test Member", chamber: "senate", state: "Abia", constituency: "Test Central",
  elected_party: "PDP", from_party: "PDP", to_party: "APC", event_date: "2024-10-02",
  source_url: "https://example.org/historical-test", source_title: "Test proceeding", outlet: "test",
  published_at: "2024-10-02T12:00:00Z", evidence_quote: "A fictional test member changes party.", verified_at: "2026-10-25",
};
const prepare = (data: unknown) => parseHistoricalEvents(data, "2026-10-25").map((e) => ({ ...e, dedupe_key: historicalKey(e) }));
const importRows = (data: unknown) => asRole(db, "service_role", (tx) => one<{ result: { inserted: number; skipped: number } }>(tx,
  "select seed_historical_events($1::jsonb) as result", [JSON.stringify(data)]));

describe("historical import", () => {
  it("imports the researched dataset with all sources and can replay it safely", async () => {
    const plan = prepare(JSON.parse(readFileSync(new URL("../../supabase/seed/defections.historical.json", import.meta.url), "utf8")));
    expect((await importRows(plan)).result).toEqual({ inserted: plan.length, skipped: 0 });
    expect((await importRows(plan)).result).toEqual({ inserted: 0, skipped: plan.length });
    expect(await one(db, "select count(*)::int as n from event_sources")).toEqual({ n: plan.length });
    expect(await one(db, "select count(*)::int as n from legislators where not is_fictional")).toEqual({ n: new Set(plan.map((e) => `${e.chamber}|${e.state}|${e.constituency}|${e.full_name}`)).size });
  });
  it("publishes a chronological chain, links sources, hides fictional data and reruns without duplicates", async () => {
    const plan = prepare([first, { ...first, from_party: "APC", to_party: "ADC", event_date: "2026-06-23" }]);
    expect((await importRows(plan)).result).toEqual({ inserted: 2, skipped: 0 });
    expect((await importRows(plan)).result).toEqual({ inserted: 0, skipped: 2 });
    expect(await one(db, `select count(*)::int as n from defection_events where model = 'historical-import' and status = 'published'`)).toEqual({ n: 2 });
    expect(await one(db, "select count(*)::int as n from event_sources")).toEqual({ n: 2 });
    expect(await one(db, "select demo_mode, historical_coverage ->> 'complete' as complete from app_settings")).toEqual({ demo_mode: false, complete: "false" });
    expect(await one(db, "select max(created_at)::date::text as latest from alerts")).toEqual({ latest: "2026-06-23" });
    const visible = await asRole(db, "anon", (tx) => one(tx, "select count(*)::int as n from legislators"));
    expect(visible).toEqual({ n: 1 });
  });

  it("rolls back the entire batch on an unknown party", async () => {
    const plan = prepare([first, { ...first, from_party: "APC", to_party: "UNKNOWN", event_date: "2026-06-23" }]);
    await expect(importRows(plan)).rejects.toThrow(/unknown party/);
    expect(await one(db, "select count(*)::int as n from defection_events")).toEqual({ n: 0 });
    expect(await one(db, "select count(*)::int as n from legislators where not is_fictional")).toEqual({ n: 0 });
  });

  it("closes a deceased member's affiliation after importing the historical event", async () => {
    const plan = prepare([{ ...first, status: "deceased", left_office_on: "2025-01-01" }]);
    await importRows(plan);
    await importRows(plan);
    expect(await one(db, "select status from legislators where not is_fictional")).toEqual({ status: "deceased" });
    expect(await one(db, "select count(*)::int as n from party_affiliations a join legislators l on l.id = a.legislator_id where not l.is_fictional and a.end_date is null")).toEqual({ n: 0 });
  });

  it("refuses anonymous and admin-session imports", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(asRole(db, role, (tx) => tx.query("select seed_historical_events($1::jsonb)", [JSON.stringify(prepare([first]))]), adminClaims)).rejects.toThrow(/permission denied/);
    }
  });
});
