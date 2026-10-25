import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { isVerbatim } from "./quote";
import { consistencyIssues, isPublishable, type ClassifierOutput } from "./schema";

// Classification (AGENT.md §4). The model gets no tools: its reply is
// constrained to the output schema (structured outputs) and then validated
// again here with Zod, including the rules JSON Schema cannot express.

export interface LlmRequest {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  /** JSON schema for `output_config.format`. */
  outputSchema: Record<string, unknown>;
}

export interface LlmResponse {
  content: Anthropic.ContentBlock[];
  text: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

export type LlmClient = (request: LlmRequest) => Promise<LlmResponse>;

// Room for adaptive thinking plus the JSON; a cut-off reply fails validation and is retried.
const MAX_TOKENS = 16_000;

export function anthropicLlm(client: Anthropic = new Anthropic()): LlmClient {
  return async ({ model, system, messages, outputSchema }) => {
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // The system prompt is identical for every article in a run.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: {
        // Haiku 5.5 defaults to medium and Sonnet 5.5 to high; one setting for both.
        effort: "medium",
        format: { type: "json_schema", schema: outputSchema },
      },
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const u = res.usage;
    return {
      content: res.content,
      text,
      stopReason: res.stop_reason,
      inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
    };
  };
}

// Keywords structured outputs reject. Zod still enforces them on the reply.
const UNSUPPORTED = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED.has(key)) continue;
    // `properties` maps names to schemas; recurse into each without filtering the names.
    out[key] =
      key === "properties" && typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strictify(v)]))
        : strictify(value);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/**
 * JSON schema for `output_config.format`. Written here rather than with the
 * SDK's zodOutputFormat, which (as of 1.3.0) folds `enum` into description
 * text, so the API would no longer restrict classes and party codes.
 */
export function outputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strictify(z.toJSONSchema(schema, { io: "output" })) as Record<string, unknown>;
}

export interface ClassifyDeps {
  llm: LlmClient;
  classifierModel: string;
  escalationModel: string;
  system: string;
  schema: z.ZodType<ClassifierOutput>;
  /** Checked before every request (AGENT_MAX_LLM_CALLS_PER_RUN). */
  canCall: () => boolean;
}

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export type ClassifyResult =
  | { status: "ok"; output: ClassifierOutput; model: string; escalated: boolean; usage: Usage }
  | { status: "error"; error: string; model: string; usage: Usage }
  /** Out of LLM calls; the article stays unprocessed for the next run. */
  | { status: "budget"; usage: Usage };

/** AGENT.md §4.3. */
export function shouldEscalate(output: ClassifierOutput): boolean {
  const publishable = isPublishable(output.classification);
  return (
    (publishable && output.certainty >= 0.4 && output.certainty <= 0.85) ||
    (output.checks.act_status === "completed" && output.checks.speculative_language_present) ||
    output.classification === "GROUP_DEFECTION" ||
    output.legislators.some((l) => l.chamber === "unknown")
  );
}

function validate(text: string, schema: z.ZodType<ClassifierOutput>): { output?: ClassifierOutput; issues: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { issues: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const issues = consistencyIssues(parsed.data);
  return issues.length ? { issues } : { output: parsed.data, issues };
}

type RunResult =
  | { status: "ok"; output: ClassifierOutput }
  | { status: "error"; error: string }
  | { status: "budget" };

async function runModel(
  deps: ClassifyDeps,
  model: string,
  userMessage: string,
  usage: Usage,
): Promise<RunResult> {
  const outputSchema = outputJsonSchema(deps.schema);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

  for (let attempt = 0; attempt < 2; attempt++) {
    if (!deps.canCall()) return { status: "budget" };
    const res = await deps.llm({ model, system: deps.system, messages, outputSchema });
    usage.calls++;
    usage.inputTokens += res.inputTokens;
    usage.outputTokens += res.outputTokens;

    if (res.stopReason === "refusal") return { status: "error", error: `${model} refused` };
    const { output, issues } = validate(res.text, deps.schema);
    if (output) return { status: "ok", output };
    if (attempt === 1) return { status: "error", error: `${model}: invalid output: ${issues.join("; ")}` };

    messages.push(
      { role: "assistant", content: res.content },
      {
        role: "user",
        content: `Your answer failed validation:\n- ${issues.join("\n- ")}\nReturn the corrected JSON object.`,
      },
    );
  }
  return { status: "error", error: "unreachable" };
}

export async function classifyArticle(deps: ClassifyDeps, userMessage: string): Promise<ClassifyResult> {
  const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const first = await runModel(deps, deps.classifierModel, userMessage, usage);
  if (first.status === "budget") return { status: "budget", usage };
  if (first.status === "error") return { status: "error", error: first.error, model: deps.classifierModel, usage };
  if (!shouldEscalate(first.output)) {
    return { status: "ok", output: first.output, model: deps.classifierModel, escalated: false, usage };
  }

  const model = `${deps.classifierModel} → ${deps.escalationModel}`;
  const second = await runModel(deps, deps.escalationModel, userMessage, usage);
  if (second.status === "ok") return { status: "ok", output: second.output, model, escalated: true, usage };
  // A failed escalation is not worse than no escalation: keep the first answer.
  return { status: "ok", output: first.output, model: deps.classifierModel, escalated: false, usage };
}

/** Flags `quote_not_verbatim` per legislator (AGENT.md §4.4). */
export function verbatimFlags(output: ClassifierOutput, articleText: string): boolean[] {
  return output.legislators.map((l) => isVerbatim(l.evidence_quote, articleText));
}
