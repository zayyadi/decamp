import "server-only";
import { z } from "zod";
import type { LegislatorQuery } from "@/lib/filters";
import { createAnonClient } from "@/lib/supabase/server";
import { chamber, num, parseRows } from "./shared";

const party = z.object({ code: z.string(), name: z.string(), color: z.string().nullable() });

const listRows = z.array(
  z.object({
    id: z.string(),
    full_name: z.string(),
    chamber,
    state: z.string(),
    constituency: z.string(),
    current_party: party,
    elected_party: z.object({ code: z.string() }),
  }),
);
export type LegislatorRow = z.infer<typeof listRows>[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id: string) => UUID.test(id);

// `%` and `_` are ilike wildcards; a search for them should match them literally.
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Sitting members. 469 at most, so party sorting happens here rather than in PostgREST. */
export async function listLegislators(q: LegislatorQuery): Promise<LegislatorRow[]> {
  const db = await createAnonClient();
  let query = db
    .from("legislators")
    .select(
      "id, full_name, chamber, state, constituency, " +
        "current_party:parties!legislators_current_party_id_fkey!inner(code, name, color), " +
        "elected_party:parties!legislators_elected_party_id_fkey(code)",
    )
    .eq("status", "sitting");
  // The roster page is the National Assembly; assembly members are listed per state (listAssemblyMembers).
  query = q.chamber ? query.eq("chamber", q.chamber) : query.in("chamber", ["senate", "house"]);
  if (q.state) query = query.eq("state", q.state);
  if (q.party) query = query.eq("current_party.code", q.party);
  if (q.q) query = query.ilike("full_name", `%${likeEscape(q.q)}%`);
  const rows = parseRows(listRows, await query.order("full_name"), "legislators");

  const key: Record<LegislatorQuery["sort"], (r: LegislatorRow) => string> = {
    name: (r) => r.full_name,
    state: (r) => `${r.state}\u0000${r.full_name}`,
    party: (r) => `${r.current_party.code}\u0000${r.full_name}`,
    chamber: (r) => `${r.chamber}\u0000${r.full_name}`,
  };
  const sorted = rows.sort((a, b) => key[q.sort](a).localeCompare(key[q.sort](b)));
  return q.dir === "desc" ? sorted.reverse() : sorted;
}

const profileRow = z.object({
  id: z.string(),
  full_name: z.string(),
  name_variants: z.array(z.string()),
  chamber,
  state: z.string(),
  constituency: z.string(),
  status: z.enum(["sitting", "former", "deceased", "vacated"]),
  photo_url: z.string().nullable(),
  source_url: z.string().nullable(),
  verified_at: z.string().nullable(),
  is_fictional: z.boolean(),
  current_party: party,
  elected_party: party,
});

const historyRows = z.array(
  z.object({
    id: num,
    start_date: z.string(),
    end_date: z.string().nullable(),
    source_url: z.string().nullable(),
    defection_event_id: z.string().nullable(),
    party,
  }),
);

export type Profile = z.infer<typeof profileRow> & { history: z.infer<typeof historyRows> };

export async function getLegislator(id: string): Promise<Profile | null> {
  if (!isUuid(id)) return null;
  const db = await createAnonClient();
  const [legislator, history] = await Promise.all([
    db
      .from("legislators")
      .select(
        "id, full_name, name_variants, chamber, state, constituency, status, photo_url, source_url, verified_at, is_fictional, " +
          "current_party:parties!legislators_current_party_id_fkey(code, name, color), " +
          "elected_party:parties!legislators_elected_party_id_fkey(code, name, color)",
      )
      .eq("id", id)
      .maybeSingle(),
    db
      .from("party_affiliations")
      .select("id, start_date, end_date, source_url, defection_event_id, party:parties(code, name, color)")
      .eq("legislator_id", id)
      .order("start_date", { ascending: false })
      .order("id", { ascending: false }),
  ]);
  const row = parseRows(profileRow.nullable(), legislator, "legislator");
  if (!row) return null;
  return { ...row, history: parseRows(historyRows, history, "party_affiliations") };
}

const assemblyRows = z.array(
  z.object({
    id: z.string(),
    full_name: z.string(),
    constituency: z.string(),
    current_party: party,
  }),
);
export type AssemblyMember = z.infer<typeof assemblyRows>[number];

/** State-assembly members on record for a state. Partial in phase 1: members join the roster through review. */
export async function listAssemblyMembers(state: string): Promise<AssemblyMember[]> {
  const db = await createAnonClient();
  const result = await db
    .from("legislators")
    .select("id, full_name, constituency, current_party:parties!legislators_current_party_id_fkey(code, name, color)")
    .eq("chamber", "state_assembly")
    .eq("state", state)
    .eq("status", "sitting")
    .order("constituency");
  return parseRows(assemblyRows, result, "assembly members");
}
