import { describe, expect, it } from "vitest";
import { buildPrefilter, filterText, needsBody, type PartyNames } from "@/agent/filter";

// A slice of the party register from the core migration.
const parties: PartyNames[] = [
  { code: "A", name: "Accord", aliases: ["Accord Party"] },
  { code: "APC", name: "All Progressives Congress", aliases: [] },
  { code: "PDP", name: "Peoples Democratic Party", aliases: [] },
  { code: "LP", name: "Labour Party", aliases: [] },
  { code: "ADC", name: "African Democratic Congress", aliases: [] },
];

const passes = buildPrefilter(parties);
const longSummary = (s: string) => s.padEnd(220, " .");

describe("pre-filter", () => {
  it.each([
    "Senator Barnabas Okeyode defects from PDP to APC",
    "Lawmaker representing Ondo Demo District federal constituency decamps to the ADC",
    "Hon. Halima Dogo-Fictional dumps PDP, joins APC at plenary",
    "Reps member joins the Labour Party",
    "Senator quits the PDP after months of crisis",
    "Lawmaker moves to Accord Party",
    "Speaker reads letter as member crosses over to APC",
    "Senator resigns his membership of the party",
    "Lawmaker joins All Progressives Congress",
    "Kano House of Assembly member dumps PDP for APC",
    "Member representing Fagge state constituency joins the ADC",
  ])("passes %j", (title) => {
    expect(passes({ title, summary: longSummary("") })).toBe(true);
  });

  it.each([
    ["defection without a legislator", "Governor defects to APC"],
    ["legislator without a defection", "Senate passes the 2027 budget"],
    ["one-letter party code as an article", "Senator joined a protest in Abuja"],
    ["party name inside a longer word", "Lawmaker joins APCX consultancy board"],
    ["no cue at all", "Mother, child killed as two trucks crash in Lagos"],
  ])("rejects %s", (_, title) => {
    expect(passes({ title, summary: longSummary("") })).toBe(false);
  });

  it("matches across title and summary", () => {
    expect(
      passes({ title: "Senator Okeyode speaks", summary: longSummary("He has defected to the APC.") }),
    ).toBe(true);
  });

  it("checks the body when the summary is short", () => {
    const input = {
      title: "Big news from Abuja",
      summary: "Read more",
      body: "The senator representing Ondo Demo District 1 defected to the APC on Tuesday.",
    };
    expect(needsBody(input.summary)).toBe(true);
    expect(passes(input)).toBe(true);
  });

  it("ignores the body when the summary is long enough", () => {
    expect(
      passes({
        title: "Big news from Abuja",
        summary: longSummary("Markets rallied."),
        body: "The senator defected to the APC.",
      }),
    ).toBe(false);
  });

  it("reads only the first 1,500 characters of the body", () => {
    const body = `${"x".repeat(1500)} Senator defects to APC`;
    expect(filterText({ title: "t", summary: "", body })).not.toContain("Senator");
    expect(passes({ title: "Weekend roundup", summary: "", body })).toBe(false);
  });

  it("builds party names from the register, not a fixed list", () => {
    const withNew = buildPrefilter([...parties, { code: "NDM", name: "New Dawn Movement", aliases: [] }]);
    expect(withNew({ title: "Senator joins NDM", summary: longSummary("") })).toBe(true);
    expect(passes({ title: "Senator joins NDM", summary: longSummary("") })).toBe(false);
  });
});
