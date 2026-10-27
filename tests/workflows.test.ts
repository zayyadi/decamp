import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The agent workflow and .env.example must agree, or a scheduled run fails
// on a variable nobody set in GitHub.

const root = join(import.meta.dirname, "..");
const workflow = readFileSync(join(root, ".github", "workflows", "agent.yml"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");

/** Server-side variables in .env.example; the NEXT_PUBLIC_* ones belong to the web app. */
const agentVars = readFileSync(join(root, ".env.example"), "utf8")
  .split("\n")
  .flatMap((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1] ?? [])
  .filter((name) => !name.startsWith("NEXT_PUBLIC_"));

describe("agent workflow", () => {
  it("runs every 15 minutes", () => {
    expect(workflow).toContain('cron: "*/15 * * * *"');
  });

  it("passes every agent variable from .env.example", () => {
    expect(agentVars.length).toBeGreaterThan(5);
    for (const name of agentVars) expect(workflow, name).toMatch(new RegExp(`^\\s+${name}: \\$\\{\\{ (secrets|vars)\\.${name} \\}\\}$`, "m"));
  });

  it("keeps keys in secrets, not plain variables", () => {
    for (const name of ["SUPABASE_SECRET_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) expect(workflow).toContain(`secrets.${name}`);
  });

  it("installs Claude Code only for the claude-cli backend, and runs the tested step script", () => {
    expect(workflow).toMatch(/if: vars\.AGENT_LLM_BACKEND == 'claude-cli'\n\s+run: npm install -g @anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
    expect(workflow).toContain("run: bash scripts/ci/run-agent.sh");
  });

  it("documents each variable in the README", () => {
    for (const name of agentVars) expect(readme, name).toContain(`\`${name}\``);
  });

  it("runs schedules live and manual runs as their dry-run checkbox says", () => {
    expect(workflow).toContain("DRY_RUN: ${{ inputs.dry_run && 'true' || 'false' }}");
  });
});
