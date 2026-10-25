import { describe, expect, it } from "vitest";
import { findMatchingEvent, independentOutlets } from "@/agent/corroborate";
import { hardGates, routeEvent } from "@/agent/route";
import { corroborationFactor, evidenceFactor, roundScore, scoreEvent } from "@/agent/score";

const thresholds = { publish: 0.85, review: 0.6 };

describe("scoreEvent: AGENT.md §6.4 worked examples", () => {
  it("plenary letter, 2 tier-1 outlets, exact match → 0.953", () => {
    const s = scoreEvent({
      certainty: 0.95,
      entityScore: 1,
      bestTier: 1,
      independentOutlets: 2,
      evidence: [{ type: "plenary_letter", verbatim: true }],
    });
    expect(s).toEqual({ C: 0.95, E: 1, T: 1, K: 0.8, V: 1, score: 0.953 });
    expect(routeEvent({ score: s.score, gates: [], entityUnique: true }, thresholds)).toEqual({
      status: "published",
      unverifiedAlert: false,
    });
  });

  it("journalist report, 1 tier-2 outlet, variant match 0.93 → 0.739", () => {
    const s = scoreEvent({
      certainty: 0.85,
      entityScore: 0.93,
      bestTier: 2,
      independentOutlets: 1,
      evidence: [{ type: "reported_completed_act", verbatim: true }],
    });
    expect(s).toEqual({ C: 0.85, E: 0.93, T: 0.7, K: 0.3, V: 0.7, score: 0.739 });
    expect(routeEvent({ score: s.score, gates: [], entityUnique: true }, thresholds)).toEqual({
      status: "in_review",
      unverifiedAlert: true,
    });
  });

  it("blog post, ambiguous fuzzy match → 0.400, review without an alert", () => {
    const s = scoreEvent({
      certainty: 0.7,
      entityScore: null,
      bestTier: 3,
      independentOutlets: 1,
      evidence: [{ type: "vague", verbatim: true }],
    });
    expect(s).toEqual({ C: 0.7, E: 0, T: 0.4, K: 0.3, V: 0.3, score: 0.4 });
    expect(routeEvent({ score: s.score, gates: ["ambiguous_entity"], entityUnique: false }, thresholds)).toEqual({
      status: "in_review",
      unverifiedAlert: false,
    });
  });
});

describe("score factors", () => {
  it("rounds half up to three places despite float noise", () => {
    expect(roundScore(0.9524999999999999)).toBe(0.953);
    expect(roundScore(0.7385)).toBe(0.739);
    expect(roundScore(0.7384)).toBe(0.738);
  });

  it.each([
    [1, 0.3],
    [2, 0.8],
    [3, 1],
    [7, 1],
  ])("corroboration for %i outlets is %f", (n, k) => {
    expect(corroborationFactor(n)).toBe(k);
  });

  it("caps evidence that is not verbatim at 0.3", () => {
    expect(evidenceFactor({ type: "plenary_letter", verbatim: false })).toBe(0.3);
    expect(evidenceFactor({ type: "legislator_direct_quote", verbatim: true })).toBe(1);
    expect(evidenceFactor({ type: "reported_completed_act", verbatim: true })).toBe(0.7);
  });

  it("uses the strongest evidence among sources", () => {
    const s = scoreEvent({
      certainty: 0.9,
      entityScore: 1,
      bestTier: 1,
      independentOutlets: 2,
      evidence: [
        { type: "vague", verbatim: true },
        { type: "legislator_direct_quote", verbatim: true },
      ],
    });
    expect(s.V).toBe(1);
  });
});

describe("hardGates", () => {
  const base = { flags: [], toParty: "APC", speculative: false, isPlenary: false, anyQuoteVerbatim: true };

  it("fires nothing for a clean event", () => {
    expect(hardGates(base)).toEqual([]);
  });

  it.each([
    [{ flags: ["ambiguous_entity"] }, "ambiguous_entity"],
    [{ flags: ["unresolved_entity"] }, "unresolved_entity"],
    [{ flags: ["party_mismatch"] }, "party_mismatch"],
    [{ flags: ["denied"] }, "denied"],
    [{ anyQuoteVerbatim: false }, "quote_not_verbatim"],
    [{ toParty: null }, "to_party_missing"],
    [{ speculative: true }, "speculative_language"],
  ])("%j fires %s", (over, gate) => {
    expect(hardGates({ ...base, ...over })).toEqual([gate]);
  });

  it("lets a plenary announcement through despite speculative language", () => {
    expect(hardGates({ ...base, speculative: true, isPlenary: true })).toEqual([]);
  });

  it("ignores flags that are only context", () => {
    expect(hardGates({ ...base, flags: ["legal_challenge"] })).toEqual([]);
  });
});

describe("routeEvent", () => {
  const r = (score: number, gates: string[] = [], entityUnique = true) => routeEvent({ score, gates, entityUnique }, thresholds);

  it("publishes at the threshold with no gates", () => {
    expect(r(0.85).status).toBe("published");
  });

  it("sends a gated high score to review with an unverified alert", () => {
    expect(r(0.95, ["party_mismatch"])).toEqual({ status: "in_review", unverifiedAlert: true });
  });

  it("sends a mid score to review with an alert only for a unique entity", () => {
    expect(r(0.7)).toEqual({ status: "in_review", unverifiedAlert: true });
    expect(r(0.7, [], false)).toEqual({ status: "in_review", unverifiedAlert: false });
  });

  it("sends a weak score to review without an alert", () => {
    expect(r(0.45)).toEqual({ status: "in_review", unverifiedAlert: false });
  });

  it("rejects below 0.30", () => {
    expect(r(0.29)).toEqual({ status: "rejected", unverifiedAlert: false });
  });

  it("uses the thresholds it is given", () => {
    expect(routeEvent({ score: 0.86, gates: [], entityUnique: true }, { publish: 0.9, review: 0.6 }).status).toBe("in_review");
  });
});

describe("corroboration", () => {
  const events = [
    { id: "a", legislatorId: "L1", toParty: "APC", eventDate: "2026-09-14", createdAt: "2026-09-15T08:00:00Z" },
    { id: "b", legislatorId: "L1", toParty: "APC", eventDate: null, createdAt: "2026-03-01T08:00:00Z" },
    { id: "c", legislatorId: "L2", toParty: "APC", eventDate: "2026-09-14", createdAt: "2026-09-15T08:00:00Z" },
  ];
  const key = { legislatorId: "L1", toParty: "APC", eventDate: "2026-09-20", observedOn: "2026-09-21" };

  it("matches the same legislator and party within 14 days", () => {
    expect(findMatchingEvent(key, events)?.id).toBe("a");
  });

  it("does not match outside the window", () => {
    expect(findMatchingEvent({ ...key, eventDate: "2026-10-05" }, events)).toBeUndefined();
  });

  it("does not match another destination party", () => {
    expect(findMatchingEvent({ ...key, toParty: "PDP" }, events)).toBeUndefined();
  });

  it("matches any destination when the candidate has none", () => {
    expect(findMatchingEvent({ ...key, toParty: null }, events)?.id).toBe("a");
  });

  it("falls back to the publication date and to created_at when dates are missing", () => {
    expect(findMatchingEvent({ ...key, eventDate: null, observedOn: "2026-03-10" }, events)?.id).toBe("b");
  });

  it("counts outlets with different text as independent and wire copies once", () => {
    expect(
      independentOutlets([
        { outlet: "A", contentHash: "h1" },
        { outlet: "B", contentHash: "h1" },
        { outlet: "C", contentHash: "h2" },
        { outlet: "C", contentHash: "h3" },
      ]),
    ).toBe(2);
  });
});
