import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createClient, query } = vi.hoisted(() => ({ createClient: vi.fn(), query: {
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
} }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
import { getPublished } from "@/lib/queries/admin";

const event = {
  id: "test-event", raw_name: "Fictional Test Member", event_date: "2026-10-01",
  created_at: "2026-10-01T12:00:00Z", reviewed_at: null, confidence: 0.95,
  legislator: null, from_party: { code: "PDP" }, to_party: { code: "APC" },
  affiliations: [{ end_date: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue(query);
  for (const method of [query.from, query.select, query.eq, query.order]) method.mockReturnValue(query);
});

describe("published admin query", () => {
  it("keeps events with RLS-hidden legislators and disables their reversal", async () => {
    query.limit.mockResolvedValue({ data: [event], error: null });
    const result = await getPublished();
    expect(result).toMatchObject([{ raw_name: event.raw_name, legislator: null, reversible: false }]);
  });

  it("preserves visible records and only permits reversal for an open affiliation", async () => {
    const legislator = { id: "member", full_name: "Fictional Test Member", chamber: "house", state: "Abia", is_fictional: true };
    query.limit.mockResolvedValue({ data: [
      event, { ...event, id: "visible", legislator },
      { ...event, id: "older", legislator, affiliations: [{ end_date: "2026-10-02" }] },
    ], error: null });
    expect((await getPublished()).map((e) => e.reversible)).toEqual([false, true, false]);
  });
});
