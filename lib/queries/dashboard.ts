import "server-only";
import { z } from "zod";
import type { Chamber, Filters } from "@/lib/filters";
import { createAnonClient } from "@/lib/supabase/server";
import { chamber, num, parseRows } from "./shared";

const filterArgs = (f: Filters) => ({
  p_chamber: f.chamber ?? null,
  p_party: f.party ?? null,
  p_state: f.state ?? null,
  p_from: f.from ?? null,
  p_to: f.to ?? null,
});

const kpiRow = z.array(
  z.object({
    total: num,
    last_7_days: num,
    top_gainer: z.string().nullable(),
    top_gainer_net: num.nullable(),
    top_loser: z.string().nullable(),
    top_loser_net: num.nullable(),
  }),
);
export type Kpis = z.infer<typeof kpiRow>[number];

export async function getKpis(f: Filters): Promise<Kpis> {
  const db = await createAnonClient();
  const [row] = parseRows(kpiRow, await db.rpc("defection_kpis", filterArgs(f)), "defection_kpis");
  return row;
}

const flowRows = z.array(z.object({ from_code: z.string(), to_code: z.string(), defections: num }));
export type Flow = z.infer<typeof flowRows>[number];

export async function getFlows(f: Filters): Promise<Flow[]> {
  const db = await createAnonClient();
  return parseRows(flowRows, await db.rpc("party_flows", filterArgs(f)), "party_flows");
}

const stateRows = z.array(
  z.object({ state: z.string(), defections: num, top_from: z.string().nullable(), top_to: z.string(), top_count: num }),
);
export type StateCount = z.infer<typeof stateRows>[number];

export async function getByState(f: Filters): Promise<StateCount[]> {
  const db = await createAnonClient();
  return parseRows(stateRows, await db.rpc("defections_by_state", filterArgs(f)), "defections_by_state");
}

const weekRows = z.array(z.object({ week_start: z.string(), defections: num }));
export type WeekCount = z.infer<typeof weekRows>[number];

export async function getByWeek(f: Filters): Promise<WeekCount[]> {
  const db = await createAnonClient();
  return parseRows(weekRows, await db.rpc("defections_by_week", filterArgs(f)), "defections_by_week");
}

const strengthRows = z.array(z.object({ code: z.string(), name: z.string(), color: z.string().nullable(), seats: num }));
export type Strength = z.infer<typeof strengthRows>[number];

export async function getStrength(c: Chamber, asOf: string): Promise<Strength[]> {
  const db = await createAnonClient();
  return parseRows(strengthRows, await db.rpc("party_strength", { p_chamber: c, p_as_of: asOf }), "party_strength");
}

const eventRows = z.array(
  z.object({
    id: z.string(),
    legislator_id: z.string(),
    full_name: z.string(),
    chamber,
    state: z.string(),
    constituency: z.string(),
    from_code: z.string().nullable(),
    to_code: z.string(),
    is_return: z.boolean(),
    effective_date: z.string(),
  }),
);
export type DashboardEvent = z.infer<typeof eventRows>[number];

export async function getEvents(f: Filters, limit = 50): Promise<DashboardEvent[]> {
  const db = await createAnonClient();
  const result = await db
    .rpc("dashboard_events", filterArgs(f))
    .select("id, legislator_id, full_name, chamber, state, constituency, from_code, to_code, is_return, effective_date")
    .order("effective_date", { ascending: false })
    .order("full_name")
    .limit(limit);
  return parseRows(eventRows, result, "dashboard_events");
}

const alertRows = z.array(
  z.object({
    id: num,
    event_id: z.string().nullable(),
    kind: z.enum(["published", "developing", "correction", "group_developing"]),
    level: z.enum(["confirmed", "unverified"]),
    title: z.string(),
    body: z.string(),
    created_at: z.string(),
  }),
);
export type Alert = z.infer<typeof alertRows>[number];

export async function getRecentAlerts(limit = 20): Promise<Alert[]> {
  const db = await createAnonClient();
  const result = await db
    .from("alerts")
    .select("id, event_id, kind, level, title, body, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  return parseRows(alertRows, result, "alerts");
}

const refRows = z.object({
  states: z.array(z.object({ name: z.string(), zone: z.string() })),
  parties: z.array(z.object({ code: z.string(), name: z.string(), color: z.string().nullable() })),
});
export type Reference = z.infer<typeof refRows>;

/** States and parties for filter menus. */
export async function getReference(): Promise<Reference> {
  const db = await createAnonClient();
  const [states, parties] = await Promise.all([
    db.from("ng_states").select("name, zone").order("name"),
    db.from("parties").select("code, name, color").order("code"),
  ]);
  return refRows.parse({
    states: parseRows(refRows.shape.states, states, "ng_states"),
    parties: parseRows(refRows.shape.parties, parties, "parties"),
  });
}

export async function getDemoMode(): Promise<boolean> {
  const db = await createAnonClient();
  return parseRows(z.boolean(), await db.rpc("demo_mode"), "demo_mode");
}

export async function getHistoricalCoverage() {
  const db = await createAnonClient();
  const result = await db.from("app_settings").select("historical_coverage").single();
  return parseRows(z.object({ historical_coverage: z.object({
    start: z.string(), reviewed_through: z.string(), latest_event: z.string(), complete: z.boolean(),
  }).nullable() }), result, "historical coverage").historical_coverage;
}
