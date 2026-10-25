import { describe, expect, it } from "vitest";
import { matchLegislator, type MatchQuery } from "@/agent/resolve/match";
import { nameTokens, normalizeName } from "@/agent/resolve/normalize";
import { jaroWinkler, ratio, tokenSetRatio } from "@/agent/resolve/similarity";
import { applyVariants } from "@/agent/resolve/variants";
import { fictionalRoster } from "../roster";

describe("jaroWinkler", () => {
  it.each([
    ["martha", "marhta", 0.961],
    ["dwayne", "duane", 0.84],
    ["dixon", "dicksonx", 0.813],
    ["jellyfish", "smellyfish", 0.896],
  ])("%s / %s ≈ %f", (a, b, expected) => {
    expect(jaroWinkler(a, b)).toBeCloseTo(expected, 3);
  });

  it("is 1 for identical strings and 0 for nothing in common", () => {
    expect(jaroWinkler("okeyode", "okeyode")).toBe(1);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("", "abc")).toBe(0);
  });
});

describe("tokenSetRatio", () => {
  it("ignores word order", () => {
    expect(tokenSetRatio("okeyode barnabas", "barnabas okeyode")).toBe(1);
  });

  it("scores a subset of names as a full match", () => {
    expect(tokenSetRatio("okeyode", "barnabas okeyode")).toBe(1);
  });

  it("matches fuzzywuzzy's ratio on a known pair", () => {
    // fuzz.ratio("kitten", "sitting") == 62 (rapidfuzz: 61.54)
    expect(ratio("kitten", "sitting")).toBeCloseTo(0.6154, 3);
  });

  it("is low for different names", () => {
    expect(tokenSetRatio("halima dogo", "barnabas okeyode")).toBeLessThan(0.5);
  });
});

describe("normalizeName", () => {
  it.each([
    ["Distinguished Senator Barnabas Okeyode", "barnabas okeyode"],
    ["Rt. Hon. Dr. Zainab Kurfi-Adamu", "zainab kurfi adamu"],
    ["High Chief (Engr.) Tonye Ebiere-Dappa", "tonye ebiere dappa"],
    ["Sen. Olúfẹ́mi Adésanyà-Kuti", "olufemi adesanya kuti"],
    ["Barr. Ibrahim Kafinta SAN", "ibrahim kafinta"],
    ["Chief Emeka Obiorah-Udeh, CFR", "emeka obiorah udeh"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeName(raw)).toBe(expected);
  });

  it("keeps an honour that comes before the name", () => {
    expect(nameTokens("San Bello")).toEqual(["san", "bello"]);
  });

  it("keeps a name made only of title words", () => {
    expect(normalizeName("Prince")).toBe("prince");
  });
});

describe("variants", () => {
  it.each([
    ["Mohammed Lawan Gidado", "muhammad lawan gidado"],
    ["Sulayman Dandume", "suleiman dandume"],
    ["Uthman Akwanga", "usman akwanga"],
    ["Yusuff Abdul Rahman Kwaru", "yusuf abdulrahman kwaru"],
    ["Abubakr Rimaye", "abubakar rimaye"],
    ["Oluwaseun Ajibade", "oluwaseun ajibade"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeName(raw)).toBe(expected);
  });

  it("joins abdul to the next token", () => {
    expect(applyVariants(["abdul", "salam", "bello"])).toEqual(["abdulsalam", "bello"]);
  });
});

describe("matchLegislator", () => {
  const roster = fictionalRoster();
  const q = (over: Partial<MatchQuery>): MatchQuery => ({
    name: "",
    chamber: "unknown",
    state: null,
    constituency: null,
    fromParty: null,
    ...over,
  });

  it("finds a unique match by full name", () => {
    const r = matchLegislator(q({ name: "Senator Barnabas Okeyode", chamber: "senate", state: "Ondo", fromParty: "PDP" }), roster);
    expect(r).toMatchObject({ status: "UNIQUE", flags: [] });
    expect(r.legislator?.fullName).toBe("Barnabas Okeyode");
    expect(r.score).toBe(1);
  });

  it("finds a unique match through a spelling variant", () => {
    const r = matchLegislator(q({ name: "Sen. Mohammed Lawan Gidado", chamber: "senate" }), roster);
    expect(r.status).toBe("UNIQUE");
    expect(r.legislator?.fullName).toBe("Muhammad Lawan Gidado");
  });

  it("finds a unique match from the roster's name variants", () => {
    const r = matchLegislator(q({ name: "Hon. Wale Ogunleye-Banjo" }), roster);
    expect(r.legislator?.fullName).toBe("Adewale Ogunleye-Banjo");
  });

  it("is ambiguous for a surname two members share", () => {
    const r = matchLegislator(q({ name: "Hon. Kurfi", chamber: "house", state: "Katsina" }), roster);
    expect(r).toMatchObject({ status: "AMBIGUOUS", legislator: null, flags: ["ambiguous_entity"] });
  });

  it("finds no match for someone off the roster", () => {
    const r = matchLegislator(q({ name: "Senator Kunle Adeboye-Fictional", chamber: "senate" }), roster);
    expect(r).toMatchObject({ status: "NO_MATCH", legislator: null, flags: ["unresolved_entity"] });
  });

  it("flags a party mismatch but still resolves the person", () => {
    const r = matchLegislator(q({ name: "Senator Kehinde Oyelaran-Bose", state: "Oyo", fromParty: "PDP" }), roster);
    expect(r.status).toBe("UNIQUE");
    expect(r.flags).toEqual(["party_mismatch"]);
    expect(r.score).toBeCloseTo(0.95, 5);
  });

  it("drops below UNIQUE on a party mismatch with nothing else to confirm the person", () => {
    const r = matchLegislator(q({ name: "Senator Kehinde Oyelaran-Bose", fromParty: "PDP" }), roster);
    expect(r).toMatchObject({ status: "AMBIGUOUS", flags: ["ambiguous_entity"] });
    expect(r.score).toBeCloseTo(0.9, 5);
  });

  it("filters by chamber", () => {
    const r = matchLegislator(q({ name: "Barnabas Okeyode", chamber: "house" }), roster);
    expect(r.status).toBe("NO_MATCH");
  });

  it("recognises a former member instead of resolving a namesake", () => {
    const r = matchLegislator(q({ name: "Sen. Idris Ocheja-Fictional" }), roster);
    expect(r.status).toBe("FORMER");
    expect(r.legislator?.status).toBe("former");
  });

  it("requires a surname overlap for a merely similar name", () => {
    // Shares only a given name with the roster.
    const r = matchLegislator(q({ name: "Barnabas Adeyemi" }), roster);
    expect(r.status).toBe("NO_MATCH");
  });
});
