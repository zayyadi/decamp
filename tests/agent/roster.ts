import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RosterEntry } from "@/agent/resolve/match";
import { parseRosterCsv } from "@/scripts/lib/roster-csv";

/** The fictional demo roster, keyed by full name, as the eval uses it. */
export function fictionalRoster(): RosterEntry[] {
  const csv = readFileSync(join(import.meta.dirname, "..", "..", "supabase", "seed", "legislators.fictional.csv"), "utf8");
  const { rows, errors } = parseRosterCsv(csv, { fictional: true });
  if (errors.length) throw new Error(errors.join("\n"));
  return rows.map((r) => ({
    id: r.full_name,
    fullName: r.full_name,
    nameVariants: r.name_variants,
    chamber: r.chamber,
    state: r.state,
    constituency: r.constituency,
    currentParty: r.current_party,
    status: r.status,
    isFictional: true,
  }));
}

export const PARTY_CODES = ["A", "AA", "AAC", "ADC", "ADP", "APC", "APGA", "APM", "APP", "BP", "LP", "NNPP", "NRM", "PDP", "PRP", "SDP", "YPP", "ZLP"];
