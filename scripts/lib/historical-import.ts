import { readFileSync } from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";
import { historicalKey, importTarget, parseHistoricalEvents } from "./historical-events";
import { loadLocalEnv } from "./load-env";

export async function seedHistorical(file: string, dryRun: boolean): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const events = parseHistoricalEvents(JSON.parse(readFileSync(file, "utf8")), today);
  const target = importTarget(events);
  const rows = events.map((e) => ({ ...e, dedupe_key: historicalKey(e) }));
  console.log(`${rows.length} sourced historical defections: ${events[0].event_date} to ${events.at(-1)?.event_date}`);
  const count = (chamber: string) => events.filter((e) => e.chamber === chamber).length;
  console.log(`Senate: ${count("senate")}; House: ${count("house")}; State assemblies: ${count("state_assembly")}`);
  console.log(target === "draft_historical_events"
    ? "Drafting into the review queue; nothing is published until an editor approves. Rerun after approvals to link follow-up events and record departures."
    : "Partial historical backfill; party totals cover seeded members only. See docs/HISTORICAL_DATA.md.");
  if (dryRun) return;
  loadLocalEnv();
  const { data, error } = await createServiceClient().rpc(target, { p_events: rows });
  if (error) throw new Error(`Historical import failed; transaction rolled back: ${error.message}`);
  console.log(data);
}
