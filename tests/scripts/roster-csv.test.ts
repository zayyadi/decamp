import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRosterCsv, ROSTER_COLUMNS } from "@/scripts/lib/roster-csv";

const header = ROSTER_COLUMNS.join(",");
const csv = (...lines: string[]) => [header, ...lines].join("\n");
// full_name,name_variants,chamber,state,constituency,elected_party,current_party,
// current_party_since,current_party_source_url,status,term_start,left_office_on,
// photo_url,source_url,verified_at
const member = (overrides: Partial<Record<(typeof ROSTER_COLUMNS)[number], string>> = {}) =>
  ROSTER_COLUMNS.map((c) => ({
    full_name: "Test Member",
    chamber: "house",
    state: "Lagos",
    constituency: "Lagos Test 1",
    elected_party: "APC",
    current_party: "APC",
    ...overrides,
  })[c as string] ?? "").join(",");

const fictional = { fictional: true };

describe("parseRosterCsv", () => {
  it("accepts the bundled fictional roster", () => {
    const text = readFileSync("supabase/seed/legislators.fictional.csv", "utf8");
    const { rows, errors } = parseRosterCsv(text, fictional);
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("normalises fields", () => {
    const { rows, errors } = parseRosterCsv(
      csv(member({ name_variants: " Mohammed X | Muhammed X |", elected_party: "apc", current_party: " apc " })),
      fictional,
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      name_variants: ["Mohammed X", "Muhammed X"],
      elected_party: "APC",
      current_party: "APC",
      status: "sitting",
    });
  });

  it("reports missing and unknown columns", () => {
    const { errors } = parseRosterCsv("full_name,chamber,shoe_size\nA B,house,9", fictional);
    expect(errors).toEqual([
      expect.stringMatching(/^missing columns: name_variants, state/),
      "unknown columns: shoe_size",
    ]);
  });

  it("cites CSV line numbers", () => {
    const { errors, rows } = parseRosterCsv(
      csv(member(), member({ full_name: "Second", constituency: "Lagos Test 2", chamber: "assembly" })),
      fictional,
    );
    expect(rows).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/^line 3: chamber /)]);
  });

  it("requires date and source for a party change", () => {
    const { errors } = parseRosterCsv(csv(member({ current_party: "PDP" })), fictional);
    expect(errors).toEqual([expect.stringMatching(/line 2: current_party differs/)]);
  });

  it("rejects impossible dates", () => {
    const { errors } = parseRosterCsv(
      csv(member({ current_party: "PDP", current_party_since: "2025-02-30", current_party_source_url: "https://example.org" })),
      fictional,
    );
    expect(errors).toEqual([expect.stringMatching(/current_party_since is not a real date/)]);
  });

  it("requires left_office_on for members who are not sitting", () => {
    const { errors } = parseRosterCsv(csv(member({ status: "former" })), fictional);
    expect(errors).toEqual([expect.stringMatching(/left_office_on is required/)]);
  });

  it("requires sources on real rows only", () => {
    const text = csv(member());
    expect(parseRosterCsv(text, fictional).errors).toEqual([]);
    expect(parseRosterCsv(text, { fictional: false }).errors).toEqual([
      expect.stringMatching(/real roster rows need source_url and verified_at/),
    ]);
  });

  it("rejects non-http source URLs", () => {
    const { errors } = parseRosterCsv(
      csv(member({ source_url: "javascript:alert(1)", verified_at: "2026-01-01" })),
      { fictional: false },
    );
    expect(errors).toEqual([expect.stringMatching(/source_url/)]);
  });

  it("rejects duplicates and double-booked seats", () => {
    const { errors } = parseRosterCsv(
      csv(member(), member(), member({ full_name: "Other Person" })),
      fictional,
    );
    expect(errors).toEqual([
      "line 3: duplicate of line 2",
      "line 3: seat already held by the sitting member on line 2",
      "line 4: seat already held by the sitting member on line 2",
    ]);
  });

  it("rejects more sitting members than seats", () => {
    const senators = Array.from({ length: 110 }, (_, i) =>
      member({ full_name: `Senator ${i}`, chamber: "senate", constituency: `D${i}` }),
    );
    const { errors } = parseRosterCsv(csv(...senators), fictional);
    expect(errors).toEqual(["110 sitting senate members exceeds the 109 seats"]);
  });

  it("rejects an empty file", () => {
    expect(parseRosterCsv(header, fictional).errors).toEqual(["CSV has no data rows"]);
  });
});
