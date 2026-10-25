import { describe, expect, it } from "vitest";
import { demoKey, planDemoEvents, type DemoLegislator } from "@/scripts/lib/demo-events";

const roster: DemoLegislator[] = Array.from({ length: 40 }, (_, i) => ({
  fullName: `Fictional Member ${String(i).padStart(2, "0")}`,
  chamber: i % 3 === 0 ? "senate" : "house",
  state: ["Kano", "Ondo", "Rivers", "Lagos"][i % 4],
  party: ["APC", "PDP", "LP", "NNPP"][i % 4],
  since: "2023-06-13",
}));

describe("planDemoEvents", () => {
  const plan = planDemoEvents(roster, { today: "2026-10-25" });

  it("plans the requested published and in-review events, one per legislator", () => {
    expect(plan.filter((e) => e.status === "published")).toHaveLength(24);
    expect(plan.filter((e) => e.status === "in_review")).toHaveLength(3);
    expect(new Set(plan.map((e) => e.full_name)).size).toBe(plan.length);
    expect(new Set(plan.map((e) => e.dedupe_key)).size).toBe(plan.length);
  });

  it("is deterministic and independent of roster order", () => {
    expect(planDemoEvents([...roster].reverse(), { today: "2026-10-25" })).toEqual(plan);
  });

  it("moves each member out of their current party, within the window", () => {
    for (const e of plan) {
      const member = roster.find((l) => l.fullName === e.full_name)!;
      expect(e.from_party).toBe(member.party);
      expect(e.to_party).not.toBe(member.party);
      expect(e.event_date < "2026-10-25").toBe(true);
      expect(e.event_date >= "2026-04-26").toBe(true);
    }
  });

  it("never dates an event on or before the member's current affiliation", () => {
    const recent = roster.map((l) => ({ ...l, since: "2026-10-20" }));
    const dated = planDemoEvents(recent, { today: "2026-10-25" });
    expect(dated.length).toBeGreaterThan(0);
    for (const e of dated) expect(e.event_date > "2026-10-20").toBe(true);
    expect(planDemoEvents(roster.map((l) => ({ ...l, since: "2026-10-24" })), { today: "2026-10-25" })).toEqual([]);
  });

  it("counts members who already have a demo event toward the quota", () => {
    const existing = new Set(plan.slice(0, 10).map((e) => e.dedupe_key));
    const rest = planDemoEvents(roster, { today: "2026-10-25", existing });
    expect(rest.map((e) => e.full_name)).toEqual(plan.slice(10).map((e) => e.full_name));
    const all = new Set(plan.map((e) => e.dedupe_key));
    expect(planDemoEvents(roster, { today: "2026-10-25", existing: all })).toEqual([]);
    expect(demoKey(roster[0])).toBe(`demo:${roster[0].chamber}-kano-fictional-member-00`);
  });

  it("labels every source as a demo on an unreachable domain", () => {
    for (const e of plan) {
      expect(e.article.title.startsWith("[Demo]")).toBe(true);
      expect(new URL(e.article.url).hostname.endsWith(".invalid")).toBe(true);
      expect(e.evidence_quote.length).toBeLessThanOrEqual(300);
      expect(e.evidence_quote).toContain("fictional");
    }
  });
});
