// Party colours for charts and badges (SPEC §4.1). The same values are written
// to `parties.color` by the dashboard migration; a test keeps the two in step.
// They are not party brand colours: each is a mid-tone picked to reach 3:1
// contrast against the page and card backgrounds of both themes
// (THEME_BACKGROUNDS), and every chart also labels parties by code, so colour
// never carries meaning alone.

export const PARTY_COLORS: Record<string, string> = {
  APC: "#3474bd",
  PDP: "#d0413c",
  LP: "#2f855a",
  NNPP: "#805ad5",
  APGA: "#b7791f",
  SDP: "#d4661c",
  ADC: "#0f8a7e",
  NDC: "#737373",
  YPP: "#8a7a0a",
  ADP: "#d23a78",
  PRP: "#64748b",
  ZLP: "#a85ca6",
  A: "#2c8a8a",
  AA: "#8d6e63",
  AAC: "#b9590f",
  APM: "#5b7d8f",
  APP: "#7c8a14",
  BP: "#c4477f",
  NRM: "#16809b",
};

/** Page and card backgrounds of both themes (app/globals.css). */
export const THEME_BACKGROUNDS = ["#ffffff", "#fff6f6", "#0c1821", "#132532"] as const;

/** For a party missing from the table, e.g. one registered after this was written. */
export const FALLBACK_PARTY_COLOR = "#737373";

export function partyColor(code: string | null | undefined, stored?: string | null): string {
  return stored ?? (code ? PARTY_COLORS[code] : undefined) ?? FALLBACK_PARTY_COLOR;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}
