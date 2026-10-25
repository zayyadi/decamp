import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RosterRow } from "@/scripts/lib/roster-csv";
import { createSeededDb, fictionalRows, legislator, seedRoster } from "./fixtures";
import { asRole, one, rows } from "./harness";

let db: PGliteInterface;
beforeEach(async () => {
  db = await createSeededDb();
});
afterEach(() => db.close());

const count = (sql: string) => one<{ n: number }>(db, `select count(*)::int as n from ${sql}`);

const row = (overrides: Partial<RosterRow>): RosterRow => ({
  full_name: "Test Member",
  name_variants: [],
  chamber: "house",
  state: "Lagos",
  constituency: "Lagos Test Constituency 9",
  elected_party: "APC",
  current_party: "APC",
  status: "sitting",
  ...overrides,
});

describe("seed_roster", () => {
  it("loads the fictional roster", async () => {
    const csv = fictionalRows();
    const sitting = (chamber: string) =>
      csv.filter((r) => r.chamber === chamber && r.status === "sitting").length;

    expect(await count("legislators where is_fictional")).toEqual({ n: csv.length });
    expect(await count("legislators where chamber = 'senate' and status = 'sitting'")).toEqual({
      n: sitting("senate"),
    });
    expect(await count("legislators where chamber = 'house' and status = 'sitting'")).toEqual({
      n: sitting("house"),
    });
  });

  it("records a seeded party change with its source", async () => {
    const history = await rows(
      db,
      `select p.code, pa.start_date::text, pa.end_date::text, pa.source_url
       from party_affiliations pa
       join parties p on p.id = pa.party_id
       join legislators l on l.id = pa.legislator_id
       where l.full_name = 'Adaeze Nwankwo-Ibe' order by pa.start_date`,
    );
    expect(history).toEqual([
      { code: "APGA", start_date: "2023-06-13", end_date: "2025-03-04", source_url: null },
      {
        code: "APC", start_date: "2025-03-04", end_date: null,
        source_url: "https://example.org/demo/defection-1",
      },
    ]);
  });

  it("closes the affiliation of a member who left office", async () => {
    const r = await one(
      db,
      `select pa.start_date::text, pa.end_date::text from party_affiliations pa
       join legislators l on l.id = pa.legislator_id
       where l.full_name = 'Idris Ocheja-Fictional'`,
    );
    expect(r).toEqual({ start_date: "2015-06-09", end_date: "2019-06-11" });
  });

  it("is idempotent", async () => {
    const before = await count("party_affiliations");
    const result = await seedRoster(db, fictionalRows());
    expect(result).toEqual({ inserted: 0, updated: fictionalRows().length, warnings: [] });
    expect(await count("party_affiliations")).toEqual(before);
  });

  it("warns about, but does not apply, a party change on re-seed", async () => {
    const changed = fictionalRows().map((r) =>
      r.full_name === "Barnabas Okeyode"
        ? { ...r, current_party: "APC", current_party_since: "2026-01-01", current_party_source_url: "https://example.org/x" }
        : r,
    );
    const result = await seedRoster(db, changed);
    expect(result.warnings).toEqual([
      expect.stringMatching(/Barnabas Okeyode is PDP in the database but APC in the file/),
    ]);
    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("PDP");
  });

  it("marks a member as former and closes their affiliation", async () => {
    const updated = fictionalRows().map((r) =>
      r.full_name === "Tonye Ebiere-Dappa"
        ? { ...r, status: "deceased" as const, left_office_on: "2026-02-01" }
        : r,
    );
    await seedRoster(db, updated);
    const r = await one(
      db,
      `select l.status, pa.end_date::text from legislators l
       join party_affiliations pa on pa.legislator_id = l.id
       where l.full_name = 'Tonye Ebiere-Dappa'`,
    );
    expect(r).toEqual({ status: "deceased", end_date: "2026-02-01" });
  });

  it("rejects a second sitting member for a seat and writes nothing", async () => {
    const before = await count("legislators");
    await expect(
      seedRoster(db, [
        row({ full_name: "Fresh Member", constituency: "Lagos Test Constituency 1" }),
        row({ full_name: "Usurper Member", state: "Ondo", chamber: "senate", constituency: "Ondo Demo District 1" }),
      ]),
    ).rejects.toThrow(/row 2: another sitting member already holds Ondo Demo District 1/);
    expect(await count("legislators")).toEqual(before);
  });

  it("enforces senate seats per state", async () => {
    const extra = [2, 3, 4].map((n) =>
      row({ full_name: `Extra Senator ${n}`, chamber: "senate", state: "Ondo", constituency: `Ondo Demo District ${n}` }),
    );
    await expect(seedRoster(db, extra)).rejects.toThrow(/Ondo has 4 sitting senators \(max 3\)/);
  });

  it.each([
    ["an unknown party", row({ elected_party: "XYZ" }), /row 1: unknown elected_party "XYZ"/],
    ["an unknown state", row({ state: "Atlantis" }), /row 1: unknown state "Atlantis"/],
    [
      "an unsourced party change",
      row({ current_party: "PDP" }),
      /row 1: current_party differs from elected_party/,
    ],
    ["a real row without a source", row({}), /row 1: .*legislators_real_rows_sourced/],
  ])("rejects %s", async (_label, bad, error) => {
    const fictional = !String(error).includes("real_rows");
    await expect(seedRoster(db, [bad], fictional)).rejects.toThrow(error);
  });

  it("accepts a real, sourced row", async () => {
    const result = await seedRoster(
      db,
      [row({ source_url: "https://example.org/roster", verified_at: "2026-10-01" })],
      false,
    );
    expect(result.inserted).toBe(1);
  });

  it("is restricted to the service role", async () => {
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("select public.seed_roster('[]'::jsonb, true)")),
    ).rejects.toThrow(/permission denied/);
  });
});
