import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { loadLocalEnv } from "./lib/load-env";
import { parseRosterCsv } from "./lib/roster-csv";

const usage = `Usage:
  npm run seed -- --file <roster.csv> [--fictional] [--dry-run]
  npm run seed -- --demo-mode on|off

  --file        Roster CSV (columns: see supabase/seed/README.md)
  --fictional   Mark every row is_fictional (demo roster)
  --dry-run     Validate the file only; no database access
  --demo-mode   Show (on) or hide (off) fictional rows to the public`;

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
      help: { type: "boolean", default: false },
    },
  });

  const demoMode = values["demo-mode"];
  if (values.help || (!values.file && demoMode === undefined)) {
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
