import { describe, expect, it } from "vitest";
import { buildEdits, reviewErrorMessage, runDuration, safeNext } from "@/lib/review";

describe("safeNext", () => {
  it("keeps admin paths", () => {
    expect(safeNext("/admin/runs")).toBe("/admin/runs");
    expect(safeNext("/admin/review?x=1")).toBe("/admin/review?x=1");
  });

  it("refuses anything that could leave the admin area or the site", () => {
    for (const bad of [undefined, null, "", "/", "/legislators", "https://evil.example", "//evil.example/admin", "/admin\\..\\x", "/admin/login"]) {
      expect(safeNext(bad), String(bad)).toBe("/admin/review");
    }
  });
});

describe("buildEdits", () => {
  const original = { legislator_id: "a", from_party: "PDP", to_party: "APC", event_date: "2026-09-14" };

  it("returns only what changed", () => {
    expect(buildEdits(original, { legislator_id: "a", from_party: "PDP", to_party: "APC", event_date: "2026-09-14" })).toEqual({});
    expect(buildEdits(original, { legislator_id: "b", to_party: "LP" })).toEqual({ legislator_id: "b", to_party: "LP" });
  });

  it("clears the origin party and date when emptied, but never the member or destination", () => {
    expect(buildEdits(original, { from_party: "", event_date: " ", legislator_id: "", to_party: "" })).toEqual({ from_party: null, event_date: null });
  });

  it("fills fields the agent left empty", () => {
    expect(buildEdits({ legislator_id: null, from_party: null, to_party: null, event_date: null }, { legislator_id: "x", to_party: "ADC" })).toEqual({
      legislator_id: "x",
      to_party: "ADC",
    });
  });
});

describe("reviewErrorMessage", () => {
  it("passes on refusals written for reviewers", () => {
    expect(reviewErrorMessage("cannot publish: legislator is already in the destination party")).toBe(
      "Cannot publish: legislator is already in the destination party",
    );
    expect(reviewErrorMessage("this event was already reviewed (status is published)")).toMatch(/^This event was already reviewed/);
  });

  it("hides anything unexpected", () => {
    expect(reviewErrorMessage('duplicate key value violates unique constraint "x"')).toBe("Something went wrong. Nothing was changed.");
    expect(reviewErrorMessage("not authorised to change party membership")).toMatch(/Sign in again/);
    expect(reviewErrorMessage(undefined)).toBe("Something went wrong. Nothing was changed.");
  });
});

describe("runDuration", () => {
  it("formats seconds and minutes, and flags runs that never finished", () => {
    expect(runDuration({ started_at: "2026-10-25T10:00:00Z", finished_at: "2026-10-25T10:00:42Z" })).toBe("42s");
    expect(runDuration({ started_at: "2026-10-25T10:00:00Z", finished_at: "2026-10-25T10:03:12Z" })).toBe("3m 12s");
    expect(runDuration({ started_at: "2026-10-25T10:00:00Z", finished_at: null })).toBe("Running or crashed");
  });
});
