import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient, LlmRequest, LlmResponse } from "@/agent/classify/classify";
import { PROMPT_VERSION } from "@/agent/classify/prompt";

// LLM responses cached on disk (AGENT.md §7), so re-running the eval is free.
// The key covers the whole request, which includes the model, the prompt
// (and so PROMPT_VERSION's text) and the article, plus the backend: answers
// from `claude -p` never stand in for API answers, or the reverse.

export const BACKENDS = ["api", "claude-cli"] as const;
export type Backend = (typeof BACKENDS)[number];

export interface CacheEntry {
  via: Backend;
  response: LlmResponse;
}

export function cacheKey(request: LlmRequest, via: Backend): string {
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion: PROMPT_VERSION, via, ...request }))
    .digest("hex");
}

export interface CacheStats {
  hits: number;
  misses: number;
}

/** `inner` is null when the backend can't be called (no API key); a cache miss then fails with a clear message. */
export function cachedLlm(inner: LlmClient | null, dir: string, stats: CacheStats, via: Backend): LlmClient {
  mkdirSync(dir, { recursive: true });
  return async (request) => {
    const file = join(dir, `${cacheKey(request, via)}.json`);
    try {
      const hit = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
      stats.hits++;
      return hit.response;
    } catch {
      // Not cached yet.
    }
    if (!inner) {
      throw new Error(
        "eval cache miss and ANTHROPIC_API_KEY is not set; set it once to fill eval/.cache/, " +
          "or run with --llm=claude-cli to use your Claude account login",
      );
    }
    const response = await inner(request);
    stats.misses++;
    const entry: CacheEntry = { via, response };
    writeFileSync(file, JSON.stringify(entry));
    return response;
  };
}
