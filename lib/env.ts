import { z } from "zod";

// Env is validated lazily, per consumer, so `npm run dev` works before any
// service is configured and each process only demands the secrets it uses.

type Source = Record<string, string | undefined>;

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const siteSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url({ protocol: /^https?$/ }).optional(),
  NEXT_PUBLIC_CORRECTIONS_URL: z.url({ protocol: /^(https|mailto)$/ }).optional(),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

// Scripts and the agent run outside Next.js, so they use the non-public URL.
const serviceSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

const threshold = (fallback: number) =>
  z.coerce.number().min(0).max(1).default(fallback);

// The ingest stage fetches and stores articles but never calls the model, so
// it runs without an API key.
const ingestSchema = serviceSchema.extend({
  AGENT_LOOKBACK_HOURS: z.coerce.number().int().positive().default(72),
  AGENT_CONTACT_URL: z.url(),
});

const agentSchema = ingestSchema
  .extend({
    // `claude-cli` classifies through `claude -p` on a Claude subscription
    // (a local login, or CLAUDE_CODE_OAUTH_TOKEN in CI) instead of an API key.
    AGENT_LLM_BACKEND: z.enum(["api", "claude-cli"]).default("api"),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    CLASSIFIER_MODEL: z.string().min(1).default("claude-haiku-5-5"),
    ESCALATION_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
    CONFIDENCE_PUBLISH: threshold(0.85),
    CONFIDENCE_REVIEW: threshold(0.6),
    AGENT_MAX_LLM_CALLS_PER_RUN: z.coerce.number().int().positive().default(60),
  })
  .refine((env) => env.CONFIDENCE_REVIEW < env.CONFIDENCE_PUBLISH, {
    message: "CONFIDENCE_REVIEW must be lower than CONFIDENCE_PUBLISH",
    path: ["CONFIDENCE_REVIEW"],
  })
  .refine((env) => env.AGENT_LLM_BACKEND !== "api" || env.ANTHROPIC_API_KEY, {
    message: "required when AGENT_LLM_BACKEND=api; set AGENT_LLM_BACKEND=claude-cli to classify with a Claude login instead",
    path: ["ANTHROPIC_API_KEY"],
  });

// Set by GitHub Actions; absent locally, where the run log only goes to stdout.
const runLogSchema = z.object({
  GITHUB_STEP_SUMMARY: z.string().min(1).optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;
export type ServiceEnv = z.infer<typeof serviceSchema>;
export type IngestEnv = z.infer<typeof ingestSchema>;
export type AgentEnv = z.infer<typeof agentSchema>;
export type RunLogEnv = z.infer<typeof runLogSchema>;

function parse<T extends z.ZodType>(schema: T, source: Source): z.infer<T> {
  // `KEY=` in a .env file arrives as "", which should mean "not set".
  const cleaned = Object.fromEntries(
    Object.entries(source).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(
      `Invalid environment variables (see .env.example):\n${lines.join("\n")}`,
    );
  }
  return result.data;
}

// NEXT_PUBLIC_* values are inlined at build time only when referenced
// literally, so they must not be read through a dynamic lookup.
export function getPublicEnv(
  source: Source = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
): PublicEnv {
  return parse(publicSchema, source);
}

export function getServerEnv(source: Source = process.env): ServerEnv {
  return parse(serverSchema, source);
}

export function getServiceEnv(source: Source = process.env): ServiceEnv {
  return parse(serviceSchema, source);
}

export function getIngestEnv(source: Source = process.env): IngestEnv {
  return parse(ingestSchema, source);
}

export function getAgentEnv(source: Source = process.env): AgentEnv {
  return parse(agentSchema, source);
}

export function getRunLogEnv(source: Source = process.env): RunLogEnv {
  return parse(runLogSchema, source);
}

export function getSiteEnv(source: Source = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_CORRECTIONS_URL: process.env.NEXT_PUBLIC_CORRECTIONS_URL,
}) {
  return parse(siteSchema, source);
}
