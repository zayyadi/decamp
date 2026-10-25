import { describe, expect, it } from "vitest";
import { addDays, isIsoDate, parseFilters, parseLegislatorQuery, toQuery, weekStart, type Filters } from "@/lib/filters";

describe("parseFilters", () => {
  it("keeps valid values", () => {
    expect(
      parseFilters({ chamber: "senate", party: "APC", state: "Akwa Ibom", from: "2026-01-01", to: "2026-03-31", asOf: "2025-06-01", week: "2026-09-14" }),
    ).toEqual({ chamber: "senate", party: "APC", state: "Akwa Ibom", from: "2026-01-01", to: "2026-03-31", asOf: "2025-06-01", week: "2026-09-14" });
  });

  it("drops invalid values instead of failing", () => {
    expect(
      parseFilters({ chamber: "lords", party: "apc; drop", state: "<script>", from: "2026-02-30", to: "yesterday", week: "2026-09-16" }),
    ).toEqual({});
  });

  it("swaps a reversed date range and takes the first of repeated params", () => {
    expect(parseFilters({ from: "2026-05-01", to: "2026-01-01", party: ["PDP", "APC"] })).toEqual({
      from: "2026-01-01",
      to: "2026-05-01",
      party: "PDP",
    });
  });
});

describe("parseLegislatorQuery", () => {
  it("defaults to name, ascending", () => {
    expect(parseLegislatorQuery({})).toEqual({ sort: "name", dir: "asc" });
  });

  it("reads search, filters and sort, trimming the search", () => {
    expect(parseLegislatorQuery({ q: "  okey ", chamber: "house", sort: "party", dir: "desc", party: "LP" })).toEqual({
      q: "okey",
      chamber: "house",
      party: "LP",
      sort: "party",
      dir: "desc",
    });
    expect(parseLegislatorQuery({ sort: "salary", dir: "sideways" })).toEqual({ sort: "name", dir: "asc" });
  });
});

describe("toQuery", () => {
  it("sorts keys, applies the patch and drops empty values", () => {
    expect(toQuery<Filters>({ state: "Kano", chamber: "senate" }, { party: "APC", chamber: undefined })).toBe("?party=APC&state=Kano");
    expect(toQuery<Filters>({}, {})).toBe("");
  });

  it("encodes spaces", () => {
    expect(toQuery<Filters>({ state: "Cross River" })).toBe("?state=Cross+River");
  });
});

describe("dates", () => {
  it("validates calendar dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2025-2-1")).toBe(false);
  });

  it("finds the Monday of a week and adds days across months", () => {
    expect(weekStart("2026-09-16")).toBe("2026-09-14");
    expect(weekStart("2026-09-14")).toBe("2026-09-14");
    expect(weekStart("2026-09-20")).toBe("2026-09-14");
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });
});
