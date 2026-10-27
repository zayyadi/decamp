import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LlmRequest } from "@/agent/classify/classify";
import { claudeCliLlm, cliArgs, renderPrompt, type Runner } from "@/agent/classify/claude-cli";

const request: LlmRequest = {
  model: "claude-haiku-5-5",
  system: "SYSTEM PROMPT",
  messages: [{ role: "user", content: "<article>text</article>" }],
  outputSchema: { type: "object" },
};

const result = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: '{"classification":"IRRELEVANT"}',
    structured_output: { classification: "IRRELEVANT" },
    stop_reason: "tool_use",
    usage: { input_tokens: 2, cache_creation_input_tokens: 1400, cache_read_input_tokens: 100, output_tokens: 50 },
    modelUsage: { "claude-haiku-5-5": {} },
    ...over,
  });

describe("renderPrompt", () => {
  it("passes a single user message through", () => {
    expect(renderPrompt(request.messages)).toBe("<article>text</article>");
  });

  it("folds a validation retry into one prompt that quotes the rejected answer", () => {
    const prompt = renderPrompt([
      { role: "user", content: "ARTICLE" },
      { role: "assistant", content: [{ type: "text", text: '{"bad":true}' }] },
      { role: "user", content: "Your answer failed validation" },
    ]);
    expect(prompt).toBe('ARTICLE\n\n<previous_answer>\n{"bad":true}\n</previous_answer>\n\nYour answer failed validation');
  });

  it("rejects a conversation that does not start with the user", () => {
    expect(() => renderPrompt([{ role: "assistant", content: "x" }])).toThrow();
  });
});

describe("cliArgs", () => {
  it("disables tools and settings and passes the model, schema and effort", () => {
    const args = cliArgs("claude-sonnet-5-5", "/tmp/s.txt", { type: "object" });
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args[0]).toBe("-p");
    expect(after("--model")).toBe("claude-sonnet-5-5");
    expect(after("--tools")).toBe("");
    expect(after("--setting-sources")).toBe("");
    expect(after("--system-prompt-file")).toBe("/tmp/s.txt");
    expect(after("--json-schema")).toBe('{"type":"object"}');
    expect(after("--effort")).toBe("medium");
    expect(args).toContain("--no-session-persistence");
  });
});

describe("claudeCliLlm", () => {
  it("runs claude in an empty directory with the prompt on stdin and maps the result", async () => {
    let seen: { cwd: string; input: string; env: NodeJS.ProcessEnv; system: string } | undefined;
    const run: Runner = async (bin, args, { cwd, input, env }) => {
      expect(bin).toBe("claude");
      seen = { cwd, input, env, system: readFileSync(args[args.indexOf("--system-prompt-file") + 1], "utf8") };
      return result();
    };
    const res = await claudeCliLlm("claude", run)(request);
    expect(seen?.input).toBe("<article>text</article>");
    expect(seen?.system).toBe("SYSTEM PROMPT");
    expect(seen?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(existsSync(join(seen!.cwd))).toBe(false);
    expect(res.text).toBe('{"classification":"IRRELEVANT"}');
    expect(res.content).toEqual([{ type: "text", text: res.text, citations: null }]);
    expect(res.inputTokens).toBe(1502);
    expect(res.outputTokens).toBe(50);
  });

  it("falls back to the result text when there is no structured output", async () => {
    const res = await claudeCliLlm("claude", async () => result({ structured_output: undefined, result: "not json" }))(request);
    expect(res.text).toBe("not json");
  });

  it("passes a refusal through for classify to handle", async () => {
    const res = await claudeCliLlm("claude", async () => result({ stop_reason: "refusal" }))(request);
    expect(res.stopReason).toBe("refusal");
  });

  it("fails on an error result", async () => {
    const llm = claudeCliLlm("claude", async () => result({ is_error: true, subtype: "error_during_execution", result: "rate limited" }));
    await expect(llm(request)).rejects.toThrow(/rate limited/);
  });

  it("fails when a different model answered", async () => {
    const llm = claudeCliLlm("claude", async () => result({ modelUsage: { "claude-sonnet-5-5": {} } }));
    await expect(llm(request)).rejects.toThrow(/instead of claude-haiku-5-5/);
  });

  it("fails on output that is not JSON", async () => {
    await expect(claudeCliLlm("claude", async () => "Please log in")(request)).rejects.toThrow(/other than JSON/);
  });
});
