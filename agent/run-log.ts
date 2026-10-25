import type { RunSummary } from "./ingest/store";

// The end-of-run summary (SPEC §10, M4): printed to the log and, on GitHub
// Actions, written to the job's step summary so a run can be read at a glance.

export interface RunLog {
  stage: string;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date;
  runId: number | null;
  /** True when the ingest stage read the configured feeds (not `--article`). */
  feedsRan: boolean;
  /** "haiku → sonnet" when the classify stage ran. */
  models?: string;
  /** Stages that threw; the others still ran. */
  stageFailures: string[];
  summary: RunSummary;
}

const MAX_ERRORS = 25;
const MAX_MESSAGE = 300;

/**
 * Per-feed and per-article errors are expected and leave the run green. A
 * stage that crashed, or every feed failing at once, points at the agent or
 * its environment rather than a publisher, so the workflow goes red.
 */
export function failureReasons(log: Pick<RunLog, "feedsRan" | "stageFailures" | "summary">): string[] {
  const reasons = log.stageFailures.map((s) => `${s} stage failed`);
  if (log.feedsRan && (log.summary.feeds_ok ?? 0) === 0) reasons.push("no feed could be read");
  return reasons;
}

export function exitCode(log: Pick<RunLog, "feedsRan" | "stageFailures" | "summary">): number {
  return failureReasons(log).length ? 1 : 0;
}

const n = (x: number | undefined) => (x ?? 0).toLocaleString("en-US");

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Error text comes from publishers and the network; keep it from breaking the table or list.
function clean(text: string): string {
  const flat = text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return flat.length > MAX_MESSAGE ? `${flat.slice(0, MAX_MESSAGE - 1)}…` : flat;
}

export function formatRunLog(log: RunLog): string {
  const s = log.summary;
  const reasons = failureReasons(log);
  const rows: [string, string][] = [
    ["Result", reasons.length ? `❌ Failed: ${reasons.join("; ")}` : "✅ OK"],
    ["Mode", log.dryRun ? "Dry run (nothing written)" : "Live"],
    ["Stage", log.stage],
    ["Run ID", log.runId === null ? "–" : String(log.runId)],
    ["Started", log.startedAt.toISOString()],
    ["Duration", duration(log.finishedAt.getTime() - log.startedAt.getTime())],
  ];
  if (s.feeds_ok !== undefined) {
    rows.push(["Feeds", `${n(s.feeds_ok)} OK, ${n(s.feeds_failed)} failed`]);
    const rate = s.articles_new ? ((100 * (s.articles_prefiltered ?? 0)) / s.articles_new).toFixed(1) : "0.0";
    rows.push(["Articles", `${n(s.articles_new)} new, ${n(s.articles_prefiltered)} passed the pre-filter (${rate}%)`]);
  }
  if (s.llm_calls !== undefined) {
    if (log.models) rows.push(["Models", log.models]);
    rows.push([
      "LLM",
      `${n(s.llm_calls)} calls · ${n(s.input_tokens)} input / ${n(s.output_tokens)} output tokens`,
    ]);
    rows.push(["Events", `${n(s.events_created)} created, ${n(s.events_published)} published`]);
  }

  const lines = ["## DecampWatch agent run", "", "| | |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)];
  if (s.errors.length) {
    lines.push("", `### Errors (${s.errors.length})`, "");
    for (const e of s.errors.slice(0, MAX_ERRORS)) lines.push(`- \`${clean(e.where)}\`: ${clean(e.message)}`);
    if (s.errors.length > MAX_ERRORS) lines.push(`- …and ${s.errors.length - MAX_ERRORS} more (see \`agent_runs.errors\`)`);
  }
  return `${lines.join("\n")}\n`;
}
