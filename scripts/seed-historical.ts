import { parseArgs } from "node:util";
import { seedHistorical } from "./lib/historical-import";

async function main() {
  const { values } = parseArgs({ options: {
    file: { type: "string", default: "supabase/seed/defections.historical.json" },
    "dry-run": { type: "boolean", default: false },
  } });
  await seedHistorical(values.file, values["dry-run"]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
