// Dashboard and roster filters live in the URL so every view can be shared
// (CLAUDE.md). Parsing is forgiving: an invalid value is dropped, not an error.

export type SearchParams = Record<string, string | string[] | undefined>;
export type Chamber = "senate" | "house";
/** Any chamber a member can sit in; the URL filters above stay federal. */
export type AnyChamber = Chamber | "state_assembly";

export interface Filters {
  chamber?: Chamber;
  /** Party code, matched on either side of a move. */
  party?: string;
  state?: string;
  from?: string;
  to?: string;
  /** Party strength "as of" date. */
  asOf?: string;
  /** Monday of a timeline week whose events are listed. */
  week?: string;
}

export const SORTS = ["name", "state", "party", "chamber"] as const;
export type Sort = (typeof SORTS)[number];

export interface LegislatorQuery {
  q?: string;
  chamber?: Chamber;
  party?: string;
  state?: string;
  sort: Sort;
  dir: "asc" | "desc";
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const date = (v: string | undefined) => (isIsoDate(v) ? v : undefined);
const chamber = (v: string | undefined): Chamber | undefined => (v === "senate" || v === "house" ? v : undefined);
const party = (v: string | undefined) => (v && /^[A-Z]{1,8}$/.test(v) ? v : undefined);
// State names come from ng_states; this only keeps junk out of the query.
const state = (v: string | undefined) => (v && /^[A-Za-z][A-Za-z ]{1,39}$/.test(v) ? v : undefined);

export function parseFilters(sp: SearchParams): Filters {
  let from = date(first(sp.from));
  let to = date(first(sp.to));
  if (from && to && from > to) [from, to] = [to, from];
  const week = date(first(sp.week));
  return prune({
    chamber: chamber(first(sp.chamber)),
    party: party(first(sp.party)),
    state: state(first(sp.state)),
    from,
    to,
    asOf: date(first(sp.asOf)),
    week: week && new Date(`${week}T00:00:00Z`).getUTCDay() === 1 ? week : undefined,
  });
}

export function parseLegislatorQuery(sp: SearchParams): LegislatorQuery {
  const sort = first(sp.sort);
  const q = first(sp.q)?.slice(0, 80);
  return {
    ...prune({ q, chamber: chamber(first(sp.chamber)), party: party(first(sp.party)), state: state(first(sp.state)) }),
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as Sort) : "name",
    dir: first(sp.dir) === "desc" ? "desc" : "asc",
  };
}

function prune<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * `?key=value` for the given filters with `patch` applied; `undefined` in the
 * patch removes a key. Keys are sorted so equal views have equal URLs.
 */
export function toQuery<T extends object>(current: T, patch: Partial<Record<keyof T, string | undefined>> = {}): string {
  const merged: Record<string, unknown> = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const key of Object.keys(merged).sort()) {
    const value = merged[key];
    if (typeof value === "string" && value !== "") params.set(key, value);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Monday (UTC) of the week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
