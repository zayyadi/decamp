import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the real CI step script with a fake `npm` that records its arguments.
// Bash isn't on the Windows dev machine's PATH by default; CI is Linux.
const script = join(import.meta.dirname, "..", "..", "scripts", "ci", "run-agent.sh");
const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-agent-"));
  writeFileSync(join(dir, "npm"), '#!/usr/bin/env bash\necho "npm $*"\nexit "${FAKE_EXIT:-0}"\n');
  chmodSync(join(dir, "npm"), 0o755);
  writeFileSync(join(dir, "summary.md"), "");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// A clean environment, so a real key in the developer's shell can't change the outcome.
const env = (extra: Record<string, string>): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  PATH: `${dir}:${process.env.PATH}`,
  ...extra,
});

function run(vars: Record<string, string>) {
  const result = spawnSync("bash", [script], {
    cwd: dir,
    encoding: "utf8",
    env: env({ GITHUB_STEP_SUMMARY: join(dir, "summary.md"), ...vars }),
  });
  return {
    status: result.status,
    out: result.stdout,
    summary: readFileSync(join(dir, "summary.md"), "utf8"),
    log: readFileSync(join(dir, "agent-run.log"), "utf8"),
  };
}

describe.skipIf(!hasBash)("scripts/ci/run-agent.sh", () => {
  it("runs the full pipeline when the backend has credentials", () => {
    const r = run({ GITHUB_EVENT_NAME: "schedule", STAGE: "all", DRY_RUN: "false", AGENT_LLM_BACKEND: "claude-cli", CLAUDE_CODE_OAUTH_TOKEN: "t" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("npm run agent -- --stage=all\n");
    expect(r.summary).toBe("");
  });

  it("falls back to ingest-only on a schedule without credentials, and says so", () => {
    const r = run({ GITHUB_EVENT_NAME: "schedule", STAGE: "all", DRY_RUN: "false", AGENT_LLM_BACKEND: "api" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("npm run agent -- --stage=ingest\n");
    expect(r.out).toContain("::warning title=Classification skipped::ANTHROPIC_API_KEY is not set for the api backend");
    expect(r.summary).toContain("**Classification skipped.**");
    expect(r.log).toContain("npm run agent -- --stage=ingest");
  });

  it("names the OAuth token when the claude-cli backend lacks it", () => {
    const r = run({ GITHUB_EVENT_NAME: "schedule", STAGE: "all", AGENT_LLM_BACKEND: "claude-cli", ANTHROPIC_API_KEY: "k" });
    expect(r.out).toContain("--stage=ingest");
    expect(r.summary).toContain("CLAUDE_CODE_OAUTH_TOKEN is not set for the claude-cli backend");
  });

  it("does what a manual run asked for, even without credentials", () => {
    const r = run({ GITHUB_EVENT_NAME: "workflow_dispatch", STAGE: "all", DRY_RUN: "true" });
    expect(r.out).toContain("npm run agent -- --stage=all --dry-run\n");
    expect(r.summary).toBe("");
  });

  it("keeps the agent's exit code despite the tee", () => {
    const r = run({ GITHUB_EVENT_NAME: "schedule", STAGE: "all", ANTHROPIC_API_KEY: "k", FAKE_EXIT: "1" });
    expect(r.status).toBe(1);
  });

  it("refuses an unknown backend", () => {
    const result = spawnSync("bash", [script], { cwd: dir, encoding: "utf8", env: env({ AGENT_LLM_BACKEND: "openai" }) });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AGENT_LLM_BACKEND must be api or claude-cli");
  });
});
