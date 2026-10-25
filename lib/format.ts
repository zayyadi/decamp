import type { Chamber } from "./filters";

// Dates are calendar days (no time zone), so format them in UTC to avoid a
// shift by one day.
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const numberFormat = new Intl.NumberFormat("en-NG");

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "–" : dateFormat.format(d);
}

export const formatNumber = (n: number) => numberFormat.format(n);

export function formatSigned(n: number): string {
  return n > 0 ? `+${formatNumber(n)}` : formatNumber(n);
}

export const chamberLabel = (c: Chamber) => (c === "senate" ? "Senate" : "House of Representatives");
export const chamberShort = (c: Chamber) => (c === "senate" ? "Senate" : "House");
export const honorific = (c: Chamber) => (c === "senate" ? "Sen." : "Hon.");

/** Today in Nigeria (WAT, UTC+1), as YYYY-MM-DD. */
export function todayInLagos(now: Date = new Date()): string {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}

/** Confidence as the public label (SPEC §6.5); the number itself is shown alongside. */
export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}
