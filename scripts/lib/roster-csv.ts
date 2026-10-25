import { parse } from "csv-parse/sync";
import { z } from "zod";

export const ROSTER_COLUMNS = [
  "full_name",
  "name_variants",
  "chamber",
  "state",
  "constituency",
  "elected_party",
  "current_party",
  "current_party_since",
  "current_party_source_url",
  "status",
  "term_start",
  "left_office_on",
  "photo_url",
  "source_url",
  "verified_at",
] as const;

const SEATS = { senate: 109, house: 360 } as const;

const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "is not a real date");

const httpUrl = z.url({ protocol: /^https?$/ });
const partyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,8}$/, "must be a party code such as APC");

const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

const rowSchema = z.object({
  full_name: z.string().trim().min(2),
  name_variants: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split("|")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  chamber: z.enum(["senate", "house"]),
  state: z.string().trim().min(2),
  constituency: z.string().trim().min(2),
  elected_party: partyCode,
  current_party: partyCode,
  current_party_since: opt(isoDate),
  current_party_source_url: opt(httpUrl),
  status: z.preprocess(
    blankToUndefined,
    z.enum(["sitting", "former", "deceased", "vacated"]).default("sitting"),
  ),
  term_start: opt(isoDate),
  left_office_on: opt(isoDate),
  photo_url: opt(httpUrl),
  source_url: opt(httpUrl),
  verified_at: opt(isoDate),
});

export type RosterRow = z.output<typeof rowSchema>;

export interface RosterParseResult {
  rows: RosterRow[];
  errors: string[];
}

/**
 * Parses and validates a roster CSV. Errors cite the CSV line number (header
 * is line 1). State names, party codes and per-state senate seats are checked
 * again by the database, which owns that reference data.
 */
export function parseRosterCsv(
  text: string,
  options: { fictional: boolean },
): RosterParseResult {
  const errors: string[] = [];
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (error) {
    return { rows: [], errors: [`CSV is malformed: ${(error as Error).message}`] };
  }

  if (records.length === 0) {
    return { rows: [], errors: ["CSV has no data rows"] };
  }

  const header = Object.keys(records[0]);
  const missing = ROSTER_COLUMNS.filter((c) => !header.includes(c));
  const unknown = header.filter((c) => !(ROSTER_COLUMNS as readonly string[]).includes(c));
  if (missing.length > 0) errors.push(`missing columns: ${missing.join(", ")}`);
  if (unknown.length > 0) errors.push(`unknown columns: ${unknown.join(", ")}`);
  if (errors.length > 0) return { rows: [], errors };

  const rows: RosterRow[] = [];
  const seen = new Map<string, number>();
  const seats = new Map<string, number>();

  records.forEach((record, index) => {
    const line = index + 2;
    const parsed = rowSchema.safeParse(record);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`line ${line}: ${issue.path.join(".")} ${issue.message}`);
      }
      return;
    }
    const row = parsed.data;

    if (row.current_party !== row.elected_party) {
      if (!row.current_party_since || !row.current_party_source_url) {
        errors.push(
          `line ${line}: current_party differs from elected_party, so current_party_since and current_party_source_url are required`,
        );
      }
    } else if (row.current_party_since || row.current_party_source_url) {
      errors.push(
        `line ${line}: current_party_since/current_party_source_url are only for members whose party changed`,
      );
    }
    if (row.status !== "sitting" && !row.left_office_on) {
      errors.push(`line ${line}: left_office_on is required when status is ${row.status}`);
    }
    if (row.status === "sitting" && row.left_office_on) {
      errors.push(`line ${line}: left_office_on must be empty for a sitting member`);
    }
    if (!options.fictional && (!row.source_url || !row.verified_at)) {
      errors.push(`line ${line}: real roster rows need source_url and verified_at`);
    }

    const key = [row.chamber, row.state, row.constituency, row.full_name]
      .map((s) => s.toLowerCase())
      .join("|");
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      errors.push(`line ${line}: duplicate of line ${firstLine}`);
    } else {
      seen.set(key, line);
    }

    if (row.status === "sitting") {
      const seat = [row.chamber, row.state, row.constituency.toLowerCase()].join("|");
      const holder = seats.get(seat);
      if (holder !== undefined) {
        errors.push(`line ${line}: seat already held by the sitting member on line ${holder}`);
      } else {
        seats.set(seat, line);
      }
    }

    rows.push(row);
  });

  for (const chamber of ["senate", "house"] as const) {
    const sitting = rows.filter((r) => r.chamber === chamber && r.status === "sitting").length;
    if (sitting > SEATS[chamber]) {
      errors.push(`${sitting} sitting ${chamber} members exceeds the ${SEATS[chamber]} seats`);
    }
  }

  return { rows: errors.length > 0 ? [] : rows, errors };
}
