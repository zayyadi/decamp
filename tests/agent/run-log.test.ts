import { describe, expect, it } from "vitest";
import type { RunSummary } from "@/agent/ingest/store";
import { exitCode, failureReasons, formatRunLog, type RunLog } from "@/agent/run-log";

const full: RunSummary = {
  feeds_ok: 9,
  feeds_failed: 1,
  articles_new: 40,
  articles_prefiltered: 2,
  llm_calls: 3,
  input_tokens: 12_345,
  output_tokens: 2_100,
  events_created: 1,
  events_published: 0,
  errors: [{ where: "punch", message: "HTTP 503" }],
};

const log = (over: Partial<RunLog> = {}): RunLog => ({
  stage: "all",
  dryRun: false,
  startedAt: new Date("2026-10-25T10:00:00Z"),
  finishedAt: new Date("2026-10-25T10:03:12Z"),
  runId: 42,
  feedsRan: true,
  models: "claude-haiku-5-5 → claude-sonnet-5-5",
  stageFailures: [],
  summary: full,
  ...over,
});

describe("exitCode", () => {
  it("stays green when one feed fails", () => {
    expect(exitCode(log())).toBe(0);
  });

  it("goes red when no feed could be read", () => {
    const l = log({ summary: { ...full, feeds_ok: 0, feeds_failed: 10 } });
    expect(failureReasons(l)).toEqual(["no feed could be read"]);
    expect(exitCode(l)).toBe(1);
  });

  it("does not count feeds when only one article was ingested", () => {
    expect(exitCode(log({ feedsRan: false, summary: { errors: [] } }))).toBe(0);
  });

  it("goes red when a stage crashed, even if the others ran", () => {
    const l = log({ stageFailures: ["ingest"], feedsRan: false, summary: { ...full, feeds_ok: undefined } });
    expect(failureReasons(l)).toEqual(["ingest stage failed"]);
    expect(exitCode(l)).toBe(1);
  });

  it("stays green when the LLM budget runs out", () => {
    const summary = { ...full, errors: [{ where: "run", message: "LLM call budget (60) reached" }] };
    expect(exitCode(log({ summary }))).toBe(0);
  });
});

describe("formatRunLog", () => {
  it("summarises feeds, articles, token counts and events", () => {
    const text = formatRunLog(log());
    expect(text).toContain("| Result | ✅ OK |");
    expect(text).toContain("| Mode | Live |");
    expect(text).toContain("| Run ID | 42 |");
    expect(text).toContain("| Duration | 3m 12s |");
    expect(text).toContain("| Feeds | 9 OK, 1 failed |");
    expect(text).toContain("| Articles | 40 new, 2 passed the pre-filter (5.0%) |");
    expect(text).toContain("| Models | claude-haiku-5-5 → claude-sonnet-5-5 |");
    expect(text).toContain("| LLM | 3 calls · 12,345 input / 2,100 output tokens |");
    expect(text).toContain("| Events | 1 created, 0 published |");
    expect(text).toContain("### Errors (1)\n\n- `punch`: HTTP 503");
  });

  it("leaves out stages that did not run", () => {
    const text = formatRunLog(log({ stage: "ingest", models: undefined, summary: { ...full, llm_calls: undefined } }));
    expect(text).toContain("| Feeds |");
    expect(text).not.toContain("| LLM |");
    expect(text).not.toContain("| Models |");
  });

  it("marks dry runs and failures", () => {
    const text = formatRunLog(log({ dryRun: true, runId: null, stageFailures: ["classify"] }));
    expect(text).toContain("| Mode | Dry run (nothing written) |");
    expect(text).toContain("| Run ID | – |");
    expect(text).toContain("| Result | ❌ Failed: classify stage failed |");
  });

  it("keeps error text on one line, escapes pipes and caps the list", () => {
    const errors = Array.from({ length: 30 }, (_, i) => ({ where: `feed-${i}`, message: `bad | row\nnext ${"x".repeat(400)}` }));
    const text = formatRunLog(log({ summary: { ...full, errors } }));
    const items = text.split("\n").filter((l) => l.startsWith("- `feed-"));
    expect(items).toHaveLength(25);
    expect(items[0]).toContain("bad \\| row next x");
    expect(items[0].length).toBeLessThan(330);
    expect(text).toContain("…and 5 more (see `agent_runs.errors`)");
  });
});
