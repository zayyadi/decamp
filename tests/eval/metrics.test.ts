import { describe, expect, it } from "vitest";
import { computeMetrics, meetsTargets, type FixtureOutcome } from "@/eval/metrics";

const confirmed = (id: string, events: FixtureOutcome["events"], predictedClass: FixtureOutcome["predictedClass"] = "CONFIRMED_DEFECTION"): FixtureOutcome => ({
  id,
  expectedClass: "CONFIRMED_DEFECTION",
  expectedLegislators: [{ roster_id: "Barnabas Okeyode", from: "PDP", to: "APC" }],
  predictedClass,
  events,
});

describe("computeMetrics", () => {
  it("scores a perfect run", () => {
    const m = computeMetrics([
      confirmed("a", [{ rosterId: "Barnabas Okeyode", toParty: "APC", status: "published" }]),
      { id: "b", expectedClass: "INTENT_OR_RUMOUR", expectedLegislators: [], predictedClass: "INTENT_OR_RUMOUR", events: [] },
    ]);
    expect(m).toMatchObject({ confirmedPrecision: 1, recall: 1, entityAccuracy: 1, failures: [] });
    expect(meetsTargets(m)).toBe(true);
  });

  it("counts a published rumour against precision", () => {
    const m = computeMetrics([
      confirmed("a", [{ rosterId: "Barnabas Okeyode", toParty: "APC", status: "published" }]),
      {
        id: "rumour",
        expectedClass: "INTENT_OR_RUMOUR",
        expectedLegislators: [],
        predictedClass: "CONFIRMED_DEFECTION",
        events: [{ rosterId: "Halima Dogo-Fictional", toParty: "ADC", status: "published" }],
      },
    ]);
    expect(m.confirmedPrecision).toBe(0.5);
    expect(meetsTargets(m)).toBe(false);
  });

  it("counts an event in review with the right person towards recall", () => {
    const m = computeMetrics([confirmed("a", [{ rosterId: "Barnabas Okeyode", toParty: "APC", status: "in_review" }])]);
    expect(m.recall).toBe(1);
  });

  it("counts a missed or rejected defection against recall", () => {
    const m = computeMetrics([
      confirmed("a", []),
      confirmed("b", [{ rosterId: "Barnabas Okeyode", toParty: "APC", status: "rejected" }]),
    ]);
    expect(m.recall).toBe(0);
  });

  it("scores entity accuracy, accepting an unresolved off-roster person", () => {
    const m = computeMetrics([
      confirmed("wrong", [{ rosterId: "Halima Dogo-Fictional", toParty: "APC", status: "in_review" }]),
      {
        id: "off-roster",
        expectedClass: "CONFIRMED_DEFECTION",
        expectedLegislators: [{ roster_id: null, from: "PDP", to: "APC" }],
        predictedClass: "CONFIRMED_DEFECTION",
        events: [{ rosterId: null, toParty: "APC", status: "in_review" }],
      },
    ]);
    expect(m.entityAccuracy).toBe(0.5);
  });

  it("builds a confusion matrix and per-class F1", () => {
    const m = computeMetrics([confirmed("a", [], "INTENT_OR_RUMOUR"), confirmed("b", [])]);
    expect(m.confusion).toEqual({ CONFIRMED_DEFECTION: { INTENT_OR_RUMOUR: 1, CONFIRMED_DEFECTION: 1 } });
    expect(m.perClass.CONFIRMED_DEFECTION).toMatchObject({ precision: 1, recall: 0.5, support: 2 });
  });
});
