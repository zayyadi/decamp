import { describe, expect, it } from "vitest";
import { formatConfidence, formatDate, formatSigned, todayInLagos } from "@/lib/format";

describe("format", () => {
  it("formats calendar dates without shifting the day", () => {
    expect(formatDate("2026-09-14")).toBe("14 Sept 2026");
    expect(formatDate(null)).toBe("–");
    expect(formatDate("not a date")).toBe("–");
  });

  it("signs net changes and rounds confidence", () => {
    expect(formatSigned(3)).toBe("+3");
    expect(formatSigned(-2)).toBe("-2");
    expect(formatSigned(0)).toBe("0");
    expect(formatConfidence(0.856)).toBe("86%");
  });

  it("uses Nigerian time for today", () => {
    expect(todayInLagos(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
    expect(todayInLagos(new Date("2026-10-25T22:59:00Z"))).toBe("2026-10-25");
  });
});
