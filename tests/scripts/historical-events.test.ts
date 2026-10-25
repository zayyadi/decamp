import { describe, expect, it } from "vitest";
import { parseHistoricalEvents } from "@/scripts/lib/historical-events";

const row = {
  full_name: "Test Member", chamber: "house", state: "Abia", constituency: "Test Seat",
  elected_party: "PDP", from_party: "PDP", to_party: "APC", event_date: "2024-10-02",
  source_url: "https://example.org/test", source_title: "Test record", outlet: "test",
  published_at: "2024-10-02T12:00:00Z", evidence_quote: "Fictional test evidence for a move.", verified_at: "2026-10-25",
};
describe("historical validation", () => {
  it("rejects duplicates, future dates and gaps in party history", () => {
    expect(() => parseHistoricalEvents([row, row], "2026-10-25")).toThrow(/Duplicate/);
    expect(() => parseHistoricalEvents([{ ...row, event_date: "2027-01-01" }], "2026-10-25")).toThrow(/date outside/);
    expect(() => parseHistoricalEvents([row, { ...row, event_date: "2025-01-01", from_party: "LP", to_party: "ADC" }], "2026-10-25")).toThrow(/party history/);
  });
});
