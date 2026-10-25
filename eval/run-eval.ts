import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { assessEvent, planArticle } from "@/agent/assess";
import { anthropicLlm, classifyArticle, type ClassifyDeps } from "@/agent/classify/classify";
import { buildSystemPrompt, buildUserMessage, PROMPT_VERSION } from "@/agent/classify/prompt";
import { CLASSES, classifierOutputSchema } from "@/agent/classify/schema";
import { buildRelevance } from "@/agent/filter";
import type { RosterEntry } from "@/agent/resolve/match";
import { getAgentEnv } from "@/lib/env";
import { loadLocalEnv } from "@/scripts/lib/load-env";
import { parseRosterCsv } from "@/scripts/lib/roster-csv";
import { BACKENDS, cachedLlm, type Backend, type CacheStats } from "./cache";
import { claudeCliLlm } from "./claude-cli";
import { computeMetrics, meetsTargets, TARGETS, type FixtureOutcome, type PredictedEvent } from "./metrics";

// Detection eval (AGENT.md §7): classify → resolve → score → route on fixed
// fixtures against the fictional roster, with the database replaced by
// in-memory data and LLM responses cached in eval/.cache/.

const root = join(import.meta.dirname, "..");
const FIXTURES = join(root, "eval", "fixtures");
const CACHE = join(root, "eval", ".cache");

const fixtureSchema = z.object({
  id: z.string(),
  article: z.object({
    title: z.string(),
    outlet: z.string(),
    url: z.string(),
    published_at: z.iso.date(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    text: z.string(),
  }),
  expected: z.object({
    classification: z.enum(CLASSES),
    legislators: z.array(
      z.object({ roster_id: z.string().nullable(), from: z.string().nullable(), to: z.string().nullable() }),
    ),
  }),
});
type Fixture = z.infer<typeof fixtureSchema>;

/** The party register lives in the core migration; read it from there rather than copy it. */
function loadParties() {
  const sql = readFileSync(join(root, "supabase", "migrations", "20261024000001_core_schema.sql"), "utf8");
  const block = sql.slice(sql.indexOf("insert into public.parties"));
  const parties = [...block.matchAll(/\('([A-Z]+)', '([^']+)', '\{([^}]*)\}'\)/g)].map((m) => ({
    code: m[1],
    name: m[2],
    aliases: m[3] ? m[3].split(",").map((a) => a.replace(/"/g, "").trim()) : [],
  }));
  if (parties.length === 0) throw new Error("could not read the party register from the core migration");
  return parties;
}

function loadRoster(): RosterEntry[] {
  const csv = readFileSync(join(root, "supabase", "seed", "legislators.fictional.csv"), "utf8");
  const { rows, errors } = parseRosterCsv(csv, { fictional: true });
  if (errors.length) throw new Error(errors.join("\n"));
  return rows.map((r) => ({
    // Fixtures name roster members by full name.
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

function loadFixtures(only?: string): Fixture[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = fixtureSchema.safeParse(JSON.parse(readFileSync(join(FIXTURES, f), "utf8")));
      if (!parsed.success) throw new Error(`${f}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      return parsed.data;
    })
    .filter((f) => !only || f.id === only);
}

const CLI_NOTICE =
  "NOTE: answers come from `claude -p` on a Claude account login, not the Messages API the agent uses.\n" +
  "Claude Code adds its own system-prompt preamble and returns structured output through a tool call,\n" +
  "so these metrics are indicative. Re-run with ANTHROPIC_API_KEY (default --llm=api) for the AGENT.md §7 gate.";

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      fixture: { type: "string" },
      verbose: { type: "boolean", default: false },
      llm: { type: "string", default: "api" },
      "claude-bin": { type: "string", default: "claude" },
    },
  });
  if (!(BACKENDS as readonly string[]).includes(values.llm)) {
    throw new Error(`--llm must be one of ${BACKENDS.join(", ")}`);
  }
  const via = values.llm as Backend;
  loadLocalEnv();
  const env = getAgentEnv({
    ...process.env,
    // The eval never touches the database or the network besides the model.
    SUPABASE_URL: process.env.SUPABASE_URL || "https://eval.invalid",
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || "eval",
    AGENT_CONTACT_URL: process.env.AGENT_CONTACT_URL || "https://eval.invalid",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "cache-only",
  });
  const live =
    via === "claude-cli" ? claudeCliLlm(values["claude-bin"]) : process.env.ANTHROPIC_API_KEY ? anthropicLlm() : null;

  const parties = loadParties();
  const roster = loadRoster();
  const fixtures = loadFixtures(values.fixture);
  const isRelevant = buildRelevance(parties);
  const thresholds = { publish: env.CONFIDENCE_PUBLISH, review: env.CONFIDENCE_REVIEW };
  const stats: CacheStats = { hits: 0, misses: 0 };
  const deps: ClassifyDeps = {
    llm: cachedLlm(live, CACHE, stats, via),
    classifierModel: env.CLASSIFIER_MODEL,
    escalationModel: env.ESCALATION_MODEL,
    system: buildSystemPrompt(parties),
    schema: classifierOutputSchema(parties.map((p) => p.code)),
    canCall: () => true,
  };

  console.log(
    `Eval: ${fixtures.length} fixtures · ${env.CLASSIFIER_MODEL} → ${env.ESCALATION_MODEL} · prompt ${PROMPT_VERSION} · via ${via}`,
  );
  if (via === "claude-cli") console.log(CLI_NOTICE);
  console.log();
  const outcomes: FixtureOutcome[] = [];
  let escalations = 0;
  for (const [i, f] of fixtures.entries()) {
    const message = buildUserMessage(
      { title: f.article.title, outlet: f.article.outlet, url: f.article.url, publishedOn: f.article.published_at, text: f.article.text },
      isRelevant,
    );
    const result = await classifyArticle(deps, message);
    const events: PredictedEvent[] = [];
    let predictedClass: FixtureOutcome["predictedClass"] = "ERROR";
    if (result.status === "ok") {
      predictedClass = result.output.classification;
      if (result.escalated) escalations++;
      const meta = {
        id: i + 1,
        outlet: f.article.outlet,
        tier: f.article.tier,
        contentHash: null,
        publishedOn: f.article.published_at,
        text: `${f.article.title}\n${f.article.text}`,
      };
      for (const plan of planArticle(result.output, meta, roster)) {
        if (plan.kind !== "event") continue;
        const { route } = assessEvent({ sources: [plan.source], match: plan.match, toParty: plan.toParty }, thresholds);
        events.push({
          rosterId: plan.match.status === "UNIQUE" ? (plan.match.legislator?.id ?? null) : null,
          toParty: plan.toParty,
          status: route.status,
        });
      }
    } else if (result.status === "error") {
      console.log(`  ${f.id}: ${result.error}`);
    }
    outcomes.push({
      id: f.id,
      expectedClass: f.expected.classification,
      expectedLegislators: f.expected.legislators,
      predictedClass,
      events,
    });
    if (values.verbose) {
      const ev = events.map((e) => `${e.rosterId ?? "?"}→${e.toParty}:${e.status}`).join(", ");
      console.log(`  ${f.id.padEnd(28)} ${f.expected.classification.padEnd(28)} ${predictedClass.padEnd(28)} ${ev}`);
    }
  }

  const m = computeMetrics(outcomes);
  console.log("\nConfusion matrix (rows: expected, columns: predicted)");
  const cols = [...new Set(outcomes.map((o) => o.predictedClass))].sort();
  console.log(`${"".padEnd(28)}${cols.map((c) => c.slice(0, 10).padStart(11)).join("")}`);
  for (const [expected, row] of Object.entries(m.confusion).sort()) {
    console.log(`${expected.padEnd(28)}${cols.map((c) => String(row[c] ?? "").padStart(11)).join("")}`);
  }
  console.log("\nPer-class F1");
  for (const [c, s] of Object.entries(m.perClass).sort()) {
    console.log(`  ${c.padEnd(28)} F1 ${s.f1.toFixed(2)}  P ${s.precision.toFixed(2)}  R ${s.recall.toFixed(2)}  n=${s.support}`);
  }
  if (m.failures.length) {
    console.log("\nMisses");
    for (const line of m.failures) console.log(`  ${line}`);
  }
  const row = (label: string, value: number, target: number, detail: string) =>
    console.log(`  ${label.padEnd(22)} ${pct(value).padStart(7)}  target ≥ ${pct(target)}  ${value >= target ? "PASS" : "FAIL"}  (${detail})`);
  console.log("\nMetrics");
  row("Confirmed precision", m.confirmedPrecision, TARGETS.confirmedPrecision, `${m.published} published`);
  row("Recall", m.recall, TARGETS.recall, `${m.expectedDefections} expected defections`);
  row("Entity accuracy", m.entityAccuracy, TARGETS.entityAccuracy, `${m.resolvedEvents} events`);
  console.log(`\nLLM: ${stats.hits} cached, ${stats.misses} live calls via ${via}; ${escalations} escalations.`);
  if (via === "claude-cli") console.log(`\n${CLI_NOTICE}`);

  return meetsTargets(m) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
