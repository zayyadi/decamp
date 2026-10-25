import { describe, expect, it } from "vitest";
import {
  getAgentEnv,
  getIngestEnv,
  getPublicEnv,
  getRunLogEnv,
  getServerEnv,
  getServiceEnv,
} from "@/lib/env";

const publicVars = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-key",
};

const agentVars = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "service-key",
  ANTHROPIC_API_KEY: "sk-test",
  AGENT_CONTACT_URL: "https://example.org/about",
};

describe("getPublicEnv", () => {
  it("accepts valid values", () => {
    expect(getPublicEnv(publicVars)).toEqual(publicVars);
  });

  it("names every missing or invalid variable", () => {
    expect(() =>
      getPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("treats empty strings as unset", () => {
    expect(() =>
      getPublicEnv({ ...publicVars, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });
});

describe("getServerEnv", () => {
  it("requires the service role key alongside the public vars", () => {
    expect(() => getServerEnv(publicVars)).toThrow(/SUPABASE_SECRET_KEY/);
  });
});

describe("getServiceEnv", () => {
  it("needs only the URL and service role key", () => {
    const env = getServiceEnv({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "service-key",
    });
    expect(env.SUPABASE_URL).toBe("https://example.supabase.co");
  });
});

describe("getIngestEnv", () => {
  it("runs without an Anthropic key", () => {
    expect(getIngestEnv({ ...agentVars, ANTHROPIC_API_KEY: undefined })).toMatchObject({ AGENT_LOOKBACK_HOURS: 72 });
  });

  it("requires a contact URL for the crawler User-Agent", () => {
    expect(() =>
      getIngestEnv({ ...agentVars, AGENT_CONTACT_URL: "" }),
    ).toThrow(/AGENT_CONTACT_URL/);
  });
});

describe("getAgentEnv", () => {
  it("applies the AGENT.md defaults", () => {
    const env = getAgentEnv(agentVars);
    expect(env).toMatchObject({
      CLASSIFIER_MODEL: "claude-haiku-5-5",
      ESCALATION_MODEL: "claude-sonnet-5-5",
      CONFIDENCE_PUBLISH: 0.85,
      CONFIDENCE_REVIEW: 0.6,
      AGENT_LOOKBACK_HOURS: 72,
      AGENT_MAX_LLM_CALLS_PER_RUN: 60,
    });
  });

  it("coerces numeric overrides", () => {
    const env = getAgentEnv({ ...agentVars, CONFIDENCE_PUBLISH: "0.9" });
    expect(env.CONFIDENCE_PUBLISH).toBe(0.9);
  });

  it("rejects a review threshold at or above the publish threshold", () => {
    expect(() =>
      getAgentEnv({
        ...agentVars,
        CONFIDENCE_PUBLISH: "0.7",
        CONFIDENCE_REVIEW: "0.7",
      }),
    ).toThrow(/CONFIDENCE_REVIEW/);
  });

  it("rejects thresholds outside 0..1", () => {
    expect(() =>
      getAgentEnv({ ...agentVars, CONFIDENCE_PUBLISH: "85" }),
    ).toThrow(/CONFIDENCE_PUBLISH/);
  });
});

describe("getRunLogEnv", () => {
  it("reads the GitHub step summary path when Actions sets it", () => {
    expect(getRunLogEnv({ GITHUB_STEP_SUMMARY: "/tmp/summary.md" }).GITHUB_STEP_SUMMARY).toBe("/tmp/summary.md");
  });

  it("is empty locally", () => {
    expect(getRunLogEnv({}).GITHUB_STEP_SUMMARY).toBeUndefined();
    expect(getRunLogEnv({ GITHUB_STEP_SUMMARY: "" }).GITHUB_STEP_SUMMARY).toBeUndefined();
  });
});
