import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LlmRequest, LlmResponse } from "@/agent/classify/classify";
import { cachedLlm, cacheKey, type CacheStats } from "@/eval/cache";

const request: LlmRequest = {
  model: "claude-haiku-5-5",
  system: "S",
  messages: [{ role: "user", content: "A" }],
  outputSchema: {},
};
const response: LlmResponse = { content: [], text: "{}", stopReason: "end_turn", inputTokens: 1, outputTokens: 1 };

describe("eval cache", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eval-cache-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keys API and claude-cli answers apart", () => {
    expect(cacheKey(request, "api")).not.toBe(cacheKey(request, "claude-cli"));
  });

  it("stores each answer labelled with its backend and serves it on the next call", async () => {
    let calls = 0;
    const stats: CacheStats = { hits: 0, misses: 0 };
    const llm = cachedLlm(async () => (calls++, response), dir, stats, "claude-cli");
    await llm(request);
    await llm(request);
    expect(calls).toBe(1);
    expect(stats).toEqual({ hits: 1, misses: 1 });
    const [file] = readdirSync(dir);
    expect(JSON.parse(readFileSync(join(dir, file), "utf8"))).toEqual({ via: "claude-cli", response });
  });

  it("does not serve a claude-cli answer to an API run", async () => {
    await cachedLlm(async () => response, dir, { hits: 0, misses: 0 }, "claude-cli")(request);
    const api = cachedLlm(null, dir, { hits: 0, misses: 0 }, "api");
    await expect(api(request)).rejects.toThrow(/--llm=claude-cli/);
  });
});
