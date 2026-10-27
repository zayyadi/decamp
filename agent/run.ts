import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getAgentEnv, getIngestEnv, getRunLogEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import { loadLocalEnv } from "@/scripts/lib/load-env";
import { anthropicLlm } from "./classify/classify";
import { claudeCliLlm } from "./classify/claude-cli";
import { buildSystemPrompt } from "./classify/prompt";
import { classifierOutputSchema } from "./classify/schema";
import { detect, type DetectResult, type PendingArticle } from "./detect";
import { buildPrefilter, buildRelevance } from "./filter";
import { PoliteFetcher, userAgentFor } from "./ingest/http";
import { ingestArticle, ingestFeeds, type IngestResult } from "./ingest/ingest";
import { dryRunStore, supabaseIngestStore, type IngestStore, type RunSummary } from "./ingest/store";
import { exitCode, formatRunLog, type RunLog } from "./run-log";
import { articleByUrl, dryRunDetectStore, loadParties, loadRoster, supabaseDetectStore } from "./publish";
import { sources } from "./sources";

const usage = `Usage:
  npm run agent -- [--stage=<stage>] [--dry-run] [--since=<ISO date>] [--article=<url>]

  --stage     ingest | classify | all (default: all)
  --dry-run   Read the database but write nothing; print every decision
  --since     Process feed items published after this date (default: AGENT_LOOKBACK_HOURS ago)
  --article   Ingest and classify one URL, for debugging`;

const STAGES = ["ingest", "classify", "all"];

// Kept between local runs. In CI it lasts one run unless the directory is cached.
const ROBOTS_CACHE = ".agent-cache/robots.json";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function reportIngest(result: IngestResult, dryRun: boolean): void {
  for (const d of result.decisions) {
    const mark = d.prefilterHit ? "HIT " : "    ";
    const state = d.stored ? "" : " (already stored)";
    const page = d.pageFetched ? ` [page, ${d.contentChars} chars kept]` : "";
    console.log(`${mark}${d.outlet}: ${d.title}${page}${state}\n      ${d.url}`);
  }
  for (const e of result.errors) console.log(`error  ${e.where}: ${e.message}`);

  const rate = result.articles_new ? (100 * result.articles_prefiltered) / result.articles_new : 0;
  console.log(
    `\n${dryRun ? "[dry run] would store" : "stored"} ${result.articles_new} new articles, ` +
      `${result.articles_prefiltered} passed the pre-filter (${rate.toFixed(1)}%). ` +
      `Feeds: ${result.feeds_ok} ok, ${result.feeds_failed} failed.\n`,
  );
}

function reportDetect(result: DetectResult, dryRun: boolean): void {
  for (const d of result.decisions) {
    console.log(`[${d.classification}] ${d.title}${d.model ? `  (${d.model})` : ""}`);
    for (const line of d.events) console.log(`      ${line}`);
  }
  for (const e of result.errors) console.log(`error  ${e.where}: ${e.message}`);
  console.log(
    `\n${dryRun ? "[dry run] " : ""}classified ${result.articlesClassified} articles with ${result.llm_calls} LLM calls ` +
      `(${result.input_tokens} input / ${result.output_tokens} output tokens). ` +
      `Events: ${result.events_created} created, ${result.events_published} published.`,
  );
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      stage: { type: "string", default: "all" },
      "dry-run": { type: "boolean", default: false },
      since: { type: "string" },
      article: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  if (!STAGES.includes(values.stage)) {
    console.error(`Unknown stage "${values.stage}"\n\n${usage}`);
    return 1;
  }
  const runIngest = values.stage !== "classify";
  const runClassify = values.stage !== "ingest";

  loadLocalEnv();
  // Validate everything the chosen stages need before touching the network.
  const agentEnv = runClassify ? getAgentEnv() : null;
  const env = agentEnv ?? getIngestEnv();
  const dryRun = values["dry-run"];

  let since = new Date(Date.now() - env.AGENT_LOOKBACK_HOURS * 3_600_000);
  if (values.since !== undefined) {
    since = new Date(values.since);
    if (Number.isNaN(since.getTime())) {
      console.error(`--since is not a date: ${values.since}`);
      return 1;
    }
  }

  const startedAt = new Date();
  const db = createServiceClient();
  const realIngest = supabaseIngestStore(db);
  const ingestStore: IngestStore = dryRun ? dryRunStore(realIngest) : realIngest;
  const runId = await ingestStore.startRun();
  const summary: RunSummary = { errors: [] };
  const stageFailures: string[] = [];
  const fail = (stage: string, error: unknown) => {
    stageFailures.push(stage);
    summary.errors.push({ where: stage, message: message(error) });
    console.error(`error  ${stage} stage: ${message(error)}`);
  };
  let feedsRan = false;
  let articleOverride: PendingArticle[] | undefined;

  // A crashed stage doesn't stop the next one: articles stored by earlier runs
  // still need classifying when today's feeds can't be read.
  if (runIngest) {
    try {
      const http = new PoliteFetcher({ userAgent: userAgentFor(env.AGENT_CONTACT_URL), robotsFile: ROBOTS_CACHE });
      const deps = { http, store: ingestStore, prefilter: buildPrefilter(await ingestStore.parties()), runId };
      let result: IngestResult;
      try {
        result = values.article
          ? await ingestArticle(deps, values.article, sources)
          : await ingestFeeds(deps, sources, since);
      } finally {
        http.robots.save();
      }
      feedsRan = !values.article;
      const { feeds_ok, feeds_failed, articles_new, articles_prefiltered, errors } = result;
      Object.assign(summary, { feeds_ok, feeds_failed, articles_new, articles_prefiltered });
      summary.errors.push(...errors);
      reportIngest(result, dryRun);

      if (values.article && result.article) {
        // Classify the page whatever the pre-filter said: this is a debugging aid.
        const stored = dryRun ? null : await articleByUrl(db, result.article.url);
        articleOverride = [
          {
            id: stored?.id ?? 0,
            url: result.article.url,
            outlet: result.article.outlet,
            title: result.article.title,
            publishedAt: result.article.publishedAt,
            content: result.article.text,
            contentHash: result.article.contentHash,
          },
        ];
      }
    } catch (error) {
      fail("ingest", error);
    }
  }

  let models: string | undefined;
  if (agentEnv && values.article && !articleOverride) {
    // Without the page there is nothing to debug, and classifying every pending article instead would surprise.
    console.log(`Not classifying: ${values.article} could not be ingested.`);
  } else if (agentEnv) {
    models = `${agentEnv.CLASSIFIER_MODEL} → ${agentEnv.ESCALATION_MODEL} via ${agentEnv.AGENT_LLM_BACKEND === "claude-cli" ? "claude -p (Claude login)" : "API"}`;
    try {
      const parties = await loadParties(db);
      const realDetect = supabaseDetectStore(db, parties);
      const result = await detect(
        {
          store: dryRun ? dryRunDetectStore(realDetect) : realDetect,
          roster: await loadRoster(db, parties),
          classify: {
            llm: agentEnv.AGENT_LLM_BACKEND === "claude-cli" ? claudeCliLlm() : anthropicLlm(),
            classifierModel: agentEnv.CLASSIFIER_MODEL,
            escalationModel: agentEnv.ESCALATION_MODEL,
            system: buildSystemPrompt(parties),
            schema: classifierOutputSchema(parties.map((p) => p.code)),
          },
          isRelevant: buildRelevance(parties),
          thresholds: { publish: agentEnv.CONFIDENCE_PUBLISH, review: agentEnv.CONFIDENCE_REVIEW },
          maxLlmCalls: agentEnv.AGENT_MAX_LLM_CALLS_PER_RUN,
          sources,
          today: new Date().toISOString().slice(0, 10),
        },
        articleOverride,
      );
      const { llm_calls, input_tokens, output_tokens, events_created, events_published, errors } = result;
      Object.assign(summary, { llm_calls, input_tokens, output_tokens, events_created, events_published });
      summary.errors.push(...errors);
      reportDetect(result, dryRun);
    } catch (error) {
      fail("classify", error);
    }
  }

  try {
    // Closes the run row, crash or not, so failures show on /admin/runs.
    await ingestStore.finishRun(runId, summary);
  } catch (error) {
    fail("record-run", error);
  }

  const log: RunLog = {
    stage: values.stage,
    dryRun,
    startedAt,
    finishedAt: new Date(),
    runId,
    feedsRan,
    models,
    stageFailures,
    summary,
  };
  const text = formatRunLog(log);
  console.log(`\n${text}`);
  const { GITHUB_STEP_SUMMARY } = getRunLogEnv();
  if (GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(GITHUB_STEP_SUMMARY, text);
    } catch (error) {
      console.error(`could not write the step summary: ${message(error)}`);
    }
  }
  return exitCode(log);
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(message(error));
    process.exit(1);
  },
);
