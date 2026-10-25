import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  FALLBACK_PARTY_COLOR,
  luminance,
  PARTY_COLORS,
  partyColor,
  THEME_BACKGROUNDS,
} from "@/lib/parties";

describe("contrast helpers", () => {
  it("match the WCAG reference values", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBe(0);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("party colours", () => {
  it.each(Object.entries(PARTY_COLORS))("%s reaches 3:1 on every theme background", (_code, color) => {
    for (const bg of THEME_BACKGROUNDS) expect(contrastRatio(color, bg), bg).toBeGreaterThanOrEqual(3);
  });

  it("are distinct", () => {
    expect(new Set(Object.values(PARTY_COLORS)).size).toBe(Object.keys(PARTY_COLORS).length);
  });

  it("prefer the stored colour and fall back for unknown parties", () => {
    expect(partyColor("APC")).toBe(PARTY_COLORS.APC);
    expect(partyColor("APC", "#123456")).toBe("#123456");
    expect(partyColor("NEW")).toBe(FALLBACK_PARTY_COLOR);
    expect(partyColor(null)).toBe(FALLBACK_PARTY_COLOR);
  });
});
