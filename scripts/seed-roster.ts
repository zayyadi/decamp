import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { planDemoEvents, type DemoLegislator } from "./lib/demo-events";
import { loadLocalEnv } from "./lib/load-env";
import { parseRosterCsv } from "./lib/roster-csv";
import { seedHistorical } from "./lib/historical-import";

const usage = `Usage:
  npm run seed -- --file <roster.csv> [--fictional] [--dry-run]
  npm run seed -- --demo-mode on|off
  npm run seed -- --demo-events [--dry-run]
  npm run seed -- --fictional-events [--dry-run]

  --file        Roster CSV (columns: see supabase/seed/README.md)
  --fictional   Mark every row is_fictional (demo roster)
  --dry-run     Validate the file only; no database access
  --demo-mode   Show (on) or hide (off) fictional rows to the public
  --demo-events Import sourced historical Senate and House defections since 2023
                and hide fictional rows (idempotent; --dry-run validates offline)
  --fictional-events Generate fictional development events and turn demo mode on`;

const demoRoster = z.array(
  z.object({
    full_name: z.string(),
    chamber: z.enum(["senate", "house"]),
    state: z.string(),
    current_party: z.object({ code: z.string() }),
    party_affiliations: z.array(z.object({ start_date: z.string(), end_date: z.string().nullable() })),
  }),
);
const demoResult = z.object({ inserted: z.number(), published: z.number(), skipped: z.number() });

async function seedDemoEvents(dryRun: boolean): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("legislators")
    .select(
      "full_name, chamber, state, current_party:parties!legislators_current_party_id_fkey(code), party_affiliations(start_date, end_date)",
    )
    .eq("is_fictional", true)
    .eq("status", "sitting");
  if (error) {
    console.error(`could not read the fictional roster: ${error.message}`);
    return 1;
  }
  const legislators: DemoLegislator[] = demoRoster.parse(data).flatMap((l) => {
    const open = l.party_affiliations.find((a) => a.end_date === null);
    return open
      ? [{ fullName: l.full_name, chamber: l.chamber, state: l.state, party: l.current_party.code, since: open.start_date }]
      : [];
  });
  if (legislators.length === 0) {
    console.error("no sitting fictional legislators; seed supabase/seed/legislators.fictional.csv first");
    return 1;
  }

  const seeded = await db.from("defection_events").select("dedupe_key").like("dedupe_key", "demo:%");
  if (seeded.error) {
    console.error(`could not read existing demo events: ${seeded.error.message}`);
    return 1;
  }
  const existing = new Set(z.array(z.object({ dedupe_key: z.string() })).parse(seeded.data).map((r) => r.dedupe_key));
  const plan = planDemoEvents(legislators, { today: new Date().toISOString().slice(0, 10), existing });
  if (existing.size) console.log(`${existing.size} demo events already present`);
  for (const e of plan) {
    console.log(`${e.status.padEnd(9)} ${e.event_date}  ${e.full_name} (${e.state}): ${e.from_party} → ${e.to_party}`);
  }
  if (dryRun) return 0;

  const written = await db.rpc("seed_demo_events", { p_events: plan });
  if (written.error) {
    console.error(`demo events failed, nothing was written: ${written.error.message}`);
    return 1;
  }
  const result = demoResult.parse(written.data);
  console.log(`demo events: ${result.inserted} new (${result.published} published), ${result.skipped} already present`);

  const mode = await db.rpc("set_demo_mode", { p_on: true });
  if (mode.error) {
    console.error(`could not turn demo mode on: ${mode.error.message}`);
    return 1;
  }
  console.log("demo mode on");
  return 0;
}

const seedResult = z.object({
  inserted: z.number(),
  updated: z.number(),
  warnings: z.array(z.string()),
});

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      fictional: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "demo-mode": { type: "string" },
      "demo-events": { type: "boolean", default: false },
      "fictional-events": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  const demoMode = values["demo-mode"];
  if (values.help || (!values.file && demoMode === undefined && !values["demo-events"] && !values["fictional-events"])) {
    console.log(usage);
    return values.help ? 0 : 1;
  }
  if (demoMode !== undefined && demoMode !== "on" && demoMode !== "off") {
    console.error(`--demo-mode must be "on" or "off"\n\n${usage}`);
    return 1;
  }

  loadLocalEnv();

  if (values.file) {
    const { rows, errors } = parseRosterCsv(readFileSync(values.file, "utf8"), {
      fictional: values.fictional,
    });
    if (errors.length > 0) {
      console.error(`${values.file}: ${errors.length} problem(s)\n  ${errors.join("\n  ")}`);
      return 1;
    }

    const count = (chamber: string) =>
      rows.filter((r) => r.chamber === chamber && r.status === "sitting").length;
    console.log(
      `${values.file}: ${rows.length} rows valid (${count("senate")} sitting senators, ${count("house")} sitting reps)${values.fictional ? ", fictional" : ""}`,
    );
    if (values["dry-run"]) return 0;

    const { data, error } = await createServiceClient().rpc("seed_roster", {
      p_rows: rows,
      p_fictional: values.fictional,
    });
    if (error) {
      console.error(`seed failed, nothing was written: ${error.message}`);
      return 1;
    }
    const result = seedResult.parse(data);
    console.log(`inserted ${result.inserted}, updated ${result.updated}`);
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  }

  if (values["demo-events"]) {
    await seedHistorical("supabase/seed/defections.historical.json", values["dry-run"]);
  }

  if (values["fictional-events"]) {
    const code = await seedDemoEvents(values["dry-run"]);
    if (code !== 0) return code;
  }

  if (demoMode !== undefined) {
    const { error } = await createServiceClient().rpc("set_demo_mode", {
      p_on: demoMode === "on",
    });
    if (error) {
      console.error(`could not set demo mode: ${error.message}`);
      return 1;
    }
    console.log(`demo mode ${demoMode}`);
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
