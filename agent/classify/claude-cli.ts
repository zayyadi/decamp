import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LlmClient } from "@/agent/classify/classify";

// LLM client that runs `claude -p` on a Claude subscription instead of
// calling the Messages API with ANTHROPIC_API_KEY (AGENT_LLM_BACKEND=claude-cli,
// and the eval's --llm=claude-cli). Locally it uses the developer's login; in
// CI, Claude Code reads CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).
// It differs from the API path: Claude Code adds its own preamble to the
// system prompt, returns structured output through a tool call rather than
// `output_config.format`, and can't replay a multi-turn conversation (see
// renderPrompt). The model still gets no tools and must answer in the schema.

export type Runner = (
  bin: string,
  args: string[],
  options: { cwd: string; input: string; env: NodeJS.ProcessEnv },
) => Promise<string>;

const TIMEOUT_MS = 5 * 60_000;

const execRunner: Runner = (bin, args, { cwd, input, env }) =>
  new Promise((resolve, reject) => {
    const child = execFile(bin, args, { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      // claude -p exits non-zero on API errors but still prints its JSON result.
      if (error && !stdout.trim()) {
        reject(new Error(`${bin} failed: ${error.message}${stderr ? `\n${stderr.trim()}` : ""}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin?.end(input);
  });

const resultSchema = z.object({
  is_error: z.boolean(),
  subtype: z.string(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  stop_reason: z.string().nullable().optional(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
  }),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
});

function messageText(content: Anthropic.MessageParam["content"]): string {
  if (typeof content === "string") return content;
  return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

/**
 * `claude -p` takes one prompt, so a retry after failed validation (user,
 * assistant, user) is folded into a single message that quotes the rejected
 * answer.
 */
export function renderPrompt(messages: Anthropic.MessageParam[]): string {
  const [first, ...rest] = messages;
  if (!first || first.role !== "user") throw new Error("the conversation must start with a user message");
  const parts = [messageText(first.content)];
  for (const m of rest) {
    parts.push(
      m.role === "assistant"
        ? `<previous_answer>\n${messageText(m.content)}\n</previous_answer>`
        : messageText(m.content),
    );
  }
  return parts.join("\n\n");
}

export function cliArgs(model: string, systemFile: string, outputSchema: Record<string, unknown>): string[] {
  return [
    "-p",
    "--output-format", "json",
    "--model", model,
    "--system-prompt-file", systemFile,
    // No tools, no project or user settings, MCP servers, skills or saved
    // session: the model sees the prompt, the article and the schema only.
    "--tools", "",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--json-schema", JSON.stringify(outputSchema),
    // Matches anthropicLlm's output_config.effort.
    "--effort", "medium",
  ];
}

export function claudeCliLlm(bin = "claude", run: Runner = execRunner): LlmClient {
  // Without the key, Claude Code falls back to the account login.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return async ({ model, system, messages, outputSchema }) => {
    // An empty working directory keeps the project's CLAUDE.md out of the context.
    const dir = mkdtempSync(join(tmpdir(), "decamp-eval-"));
    try {
      const systemFile = join(dir, "system.txt");
      writeFileSync(systemFile, system);
      const stdout = await run(bin, cliArgs(model, systemFile, outputSchema), {
        cwd: dir,
        input: renderPrompt(messages),
        env,
      });
      let raw: unknown;
      try {
        raw = JSON.parse(stdout);
      } catch {
        throw new Error(`${bin} printed something other than JSON: ${stdout.slice(0, 200)}`);
      }
      const res = resultSchema.parse(raw);
      if (res.is_error) throw new Error(`${bin} -p (${model}) failed: ${res.subtype}: ${res.result ?? ""}`);
      // A fallback model must not stand in for the one under test.
      const used = Object.keys(res.modelUsage ?? {});
      if (used.length && !used.every((m) => m === model)) {
        throw new Error(`${bin} -p answered with ${used.join(", ")} instead of ${model}`);
      }
      const text = res.structured_output === undefined ? (res.result ?? "") : JSON.stringify(res.structured_output);
      const u = res.usage;
      return {
        content: [{ type: "text", text, citations: null }],
        text,
        stopReason: res.stop_reason ?? null,
        // Includes Claude Code's own preamble, so higher than the API path.
        inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
