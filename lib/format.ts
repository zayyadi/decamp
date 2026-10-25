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

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "5 minutes ago". A time slightly ahead of `now` (clock skew, a live arrival) reads "just now". */
export function relativeTime(iso: string, now: number): string {
  const minutes = Math.round(Math.min(0, Date.parse(iso) - now) / 60_000);
  if (minutes === 0) return "just now";
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  return Math.abs(days) < 30 ? rtf.format(days, "day") : formatDate(iso);
}
