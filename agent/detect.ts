import { assessEvent, planArticle, type ArticleMeta, type Plan, type SourceEvidence } from "./assess";
import { classifyArticle, type ClassifyDeps } from "./classify/classify";
import { buildUserMessage, PROMPT_VERSION } from "./classify/prompt";
import type { ClassifierOutput } from "./classify/schema";
import { findMatchingEvent } from "./corroborate";
import type { MatchResult, RosterEntry } from "./resolve/match";
import { normalizeName } from "./resolve/normalize";
import type { Route, Thresholds } from "./route";
import type { ScoreBreakdown } from "./score";
import { sourceForUrl, type Source, type Tier } from "./sources";

// Detection stage (AGENT.md §1, S4–S9): classify each pre-filtered article,
// resolve names, attach to or create events, score, route and emit.

export interface PendingArticle {
  id: number;
  url: string;
  outlet: string;
  title: string;
  publishedAt: string | null;
  content: string | null;
  contentHash: string | null;
}

export interface StoredEvent {
  id: string;
  legislatorId: string | null;
  toParty: string | null;
  eventDate: string | null;
  createdAt: string;
  status: string;
  flags: string[];
  /** An editor has acted on it; the agent no longer changes its status. */
  reviewed: boolean;
  breakdown: StoredBreakdown;
}

/** `defection_events.score_breakdown`: the factors plus what is needed to rescore later. */
export interface StoredBreakdown extends Partial<ScoreBreakdown> {
  entity?: { status: MatchResult["status"]; score: number; runnerUpScore: number };
  sources?: SourceEvidence[];
  counterEvidence?: { articleId: number; classification: string; quote: string }[];
}

export interface NewEvent {
  dedupe_key: string;
  legislator_id: string | null;
  raw_name: string;
  from_party: string | null;
  to_party: string | null;
  event_type: "CONFIRMED_DEFECTION" | "FORMAL_PLENARY_ANNOUNCEMENT" | "GROUP_DEFECTION";
  is_return: boolean;
  event_date: string | null;
  announced_date: string;
  chamber: "senate" | "house" | null;
  state: string | null;
  reason_given: string | null;
  confidence: number;
  score_breakdown: StoredBreakdown;
  status: "detected" | "in_review" | "rejected";
  review_flags: string[];
  evidence_quote: string;
  reasoning_summary: string;
  model: string;
  prompt_version: string;
}

export interface NewAlert {
  event_id: string | null;
  kind: "developing" | "group_developing";
  level: "unverified";
  title: string;
  body: string;
  is_fictional: boolean;
  dedupe_key: string;
}

export interface DetectStore {
  pendingArticles(limit: number): Promise<PendingArticle[]>;
  /** An earlier, classified article with the same text (a syndicated copy). */
  syndicatedFrom(article: PendingArticle): Promise<{ articleId: number; classification: string } | null>;
  eventsSourcedBy(articleId: number): Promise<(StoredEvent & { quote: string })[]>;
  eventsFor(legislatorId: string): Promise<StoredEvent[]>;
  /** `created` is false when the dedupe key already exists. */
  insertEvent(event: NewEvent): Promise<{ id: string; created: boolean }>;
  addSource(eventId: string, articleId: number, quote: string): Promise<void>;
  updateEvent(
    id: string,
    patch: { confidence?: number; score_breakdown?: StoredBreakdown; review_flags?: string[]; status?: "in_review" | "rejected"; review_note?: string },
  ): Promise<void>;
  /** Runs publish_defection. Returns the refusal message, or null on success. */
  publish(eventId: string): Promise<string | null>;
  insertAlert(alert: NewAlert): Promise<void>;
  markArticle(id: number, classification: string): Promise<void>;
}

export interface DetectDeps {
  store: DetectStore;
  roster: RosterEntry[];
  classify: Omit<ClassifyDeps, "canCall">;
  isRelevant: (passage: string) => boolean;
  thresholds: Thresholds;
  maxLlmCalls: number;
  sources: Source[];
  today: string;
}

export interface Decision {
  articleId: number;
  title: string;
  classification: string;
  model?: string;
  events: string[];
}

export interface DetectResult {
  articlesClassified: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  events_created: number;
  events_published: number;
  budgetExhausted: boolean;
  errors: { where: string; message: string }[];
  decisions: Decision[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const honorific = (l: RosterEntry) => (l.chamber === "senate" ? "Sen." : "Hon.");
const tierFor = (url: string, sources: Source[]): Tier => sourceForUrl(url, sources)?.tier ?? 3;

function articleMeta(a: PendingArticle, deps: DetectDeps): ArticleMeta {
  return {
    id: a.id,
    outlet: a.outlet,
    tier: tierFor(a.url, deps.sources),
    contentHash: a.contentHash,
    publishedOn: (a.publishedAt ?? deps.today).slice(0, 10),
    text: `${a.title}\n${a.content ?? ""}`,
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function emitUnverified(deps: DetectDeps, eventId: string, legislator: RosterEntry, toParty: string, sources: number) {
  await deps.store.insertAlert({
    event_id: eventId,
    kind: "developing",
    level: "unverified",
    title: `Developing: reports say ${honorific(legislator)} ${legislator.fullName} has defected to ${toParty}`,
    body: `Not yet confirmed; party counts are unchanged. ${plural(sources, "source")}.`,
    is_fictional: legislator.isFictional,
    dedupe_key: `event:${eventId}:developing`,
  });
}

/** Applies a route to a stored event. Returns a short description for the log. */
async function applyRoute(
  deps: DetectDeps,
  eventId: string,
  currentStatus: string,
  route: Route,
  legislator: RosterEntry | null,
  toParty: string | null,
  sourceCount: number,
  result: DetectResult,
): Promise<string> {
  if (route.status === "published") {
    const refusal = await deps.store.publish(eventId);
    if (refusal === null) {
      result.events_published++;
      return "published";
    }
    // The database is the last check (stale roster, already in that party, …).
    await deps.store.updateEvent(eventId, { status: "in_review", review_note: `publish refused: ${refusal}` });
    return `review (publish refused: ${refusal})`;
  }
  if (route.status !== currentStatus) await deps.store.updateEvent(eventId, { status: route.status });
  if (route.unverifiedAlert && legislator && toParty) {
    await emitUnverified(deps, eventId, legislator, toParty, sourceCount);
    return `${route.status} + unverified alert`;
  }
  return route.status;
}

async function handleEvent(
  deps: DetectDeps,
  plan: Extract<Plan, { kind: "event" }>,
  output: ClassifierOutput,
  article: PendingArticle,
  model: string,
  result: DetectResult,
): Promise<string> {
  const legislator = plan.match.status === "UNIQUE" ? plan.match.legislator : null;
  const name = plan.extracted.name_as_written;
  const entity = { status: plan.match.status, score: plan.match.score, runnerUpScore: plan.match.runnerUpScore };

  if (legislator) {
    const existing = findMatchingEvent(
      {
        legislatorId: legislator.id,
        toParty: plan.toParty,
        eventDate: plan.extracted.event_date,
        observedOn: (article.publishedAt ?? deps.today).slice(0, 10),
      },
      await deps.store.eventsFor(legislator.id),
    );
    if (existing) {
      const sources = [...(existing.breakdown.sources ?? [])];
      if (sources.some((s) => s.articleId === article.id)) return `${name}: already sourced`;
      sources.push(plan.source);
      await deps.store.addSource(existing.id, article.id, plan.source.quote);

      const assessment = assessEvent(
        { sources, match: plan.match, extraFlags: existing.flags.filter((f) => f === "denied"), toParty: existing.toParty },
        deps.thresholds,
      );
      const breakdown = { ...existing.breakdown, ...assessment.breakdown, entity, sources };
      const flags = [...new Set([...existing.flags.filter((f) => !assessment.gates.includes(f)), ...assessment.gates])];
      await deps.store.updateEvent(existing.id, { confidence: assessment.breakdown.score, score_breakdown: breakdown, review_flags: flags });

      if (existing.status === "published" || existing.reviewed) {
        return `${name}: corroborates event ${existing.id} (${existing.status}), score ${assessment.breakdown.score}`;
      }
      const outcome = await applyRoute(deps, existing.id, existing.status, assessment.route, legislator, existing.toParty, sources.length, result);
      return `${name}: corroborates event ${existing.id} → ${outcome}, score ${assessment.breakdown.score}`;
    }
  }

  const assessment = assessEvent({ sources: [plan.source], match: plan.match, toParty: plan.toParty }, deps.thresholds);
  const { route, breakdown, gates } = assessment;
  const event: NewEvent = {
    dedupe_key: `${article.id}:${legislator?.id ?? normalizeName(name)}`,
    legislator_id: legislator?.id ?? null,
    raw_name: name,
    from_party: plan.fromParty,
    to_party: plan.toParty,
    event_type: output.classification as NewEvent["event_type"],
    is_return: plan.extracted.is_return,
    event_date: plan.extracted.event_date,
    announced_date: (article.publishedAt ?? deps.today).slice(0, 10),
    chamber: legislator?.chamber ?? (plan.extracted.chamber === "unknown" ? null : plan.extracted.chamber),
    // `state` references ng_states, so only a roster value is safe to store.
    state: legislator?.state ?? null,
    reason_given: plan.extracted.reason_given,
    confidence: breakdown.score,
    score_breakdown: { ...breakdown, entity, sources: [plan.source] },
    status: route.status === "published" ? "detected" : route.status,
    review_flags: [...new Set([...plan.match.flags, ...gates])],
    evidence_quote: plan.extracted.evidence_quote,
    reasoning_summary: output.reasoning_summary,
    model,
    prompt_version: PROMPT_VERSION,
  };
  const { id, created } = await deps.store.insertEvent(event);
  if (!created) return `${name}: event already exists`;
  await deps.store.addSource(id, article.id, plan.extracted.evidence_quote);
  result.events_created++;

  const outcome = await applyRoute(deps, id, event.status, route, legislator, plan.toParty, 1, result);
  const who = legislator ? legislator.fullName : `${name} (${plan.match.status})`;
  const gateNote = gates.length ? ` [${gates.join(", ")}]` : "";
  return `${who}: new event → ${outcome}, score ${breakdown.score}${gateNote}`;
}

const SUBJECT_FLAG = { DENIAL: "denied", REVERSAL: "reversal_reported", LEGAL_CHALLENGE: "legal_challenge" } as const;

async function handleSubject(
  deps: DetectDeps,
  plan: Extract<Plan, { kind: "subject" }>,
  article: PendingArticle,
): Promise<string> {
  const name = plan.extracted.name_as_written;
  if (plan.match.status !== "UNIQUE" || !plan.match.legislator) return `${name}: ${plan.classification}, no unique match`;
  const legislator = plan.match.legislator;
  const events = await deps.store.eventsFor(legislator.id);
  // A suit can come months after the defection, so it attaches to the latest event.
  const target =
    plan.classification === "LEGAL_CHALLENGE"
      ? events
          .filter((e) => plan.toParty === null || e.toParty === plan.toParty)
          .sort((a, b) => (b.eventDate ?? b.createdAt).localeCompare(a.eventDate ?? a.createdAt))[0]
      : findMatchingEvent(
          {
            legislatorId: legislator.id,
            toParty: plan.toParty,
            eventDate: plan.extracted.event_date,
            observedOn: (article.publishedAt ?? deps.today).slice(0, 10),
          },
          events,
        );
  if (!target) return `${legislator.fullName}: ${plan.classification}, no matching event`;

  const flags = new Set(target.flags);
  flags.add(SUBJECT_FLAG[plan.classification]);
  if (plan.classification === "DENIAL" && target.status === "published") flags.add("denied_after_publish");
  const counterEvidence = [
    ...(target.breakdown.counterEvidence ?? []),
    { articleId: article.id, classification: plan.classification, quote: plan.extracted.evidence_quote },
  ];
  // A denial forces review of an unpublished event; published ones are never reversed automatically.
  const moveToReview = plan.classification === "DENIAL" && !target.reviewed && (target.status === "detected" || target.status === "rejected");
  await deps.store.updateEvent(target.id, {
    review_flags: [...flags],
    score_breakdown: { ...target.breakdown, counterEvidence },
    ...(moveToReview ? { status: "in_review" as const } : {}),
  });
  return `${legislator.fullName}: ${plan.classification} flagged on event ${target.id} (${target.status})`;
}

async function handleGroupRemainder(
  deps: DetectDeps,
  plan: Extract<Plan, { kind: "group_remainder" }>,
  output: ClassifierOutput,
  article: PendingArticle,
  model: string,
  namedFictional: boolean,
  result: DetectResult,
): Promise<string> {
  const chamberWord = plan.chamber === "senate" ? "Senate" : plan.chamber === "house" ? "House" : "National Assembly";
  const quote = output.legislators[0]?.evidence_quote ?? output.reasoning_summary.slice(0, 300);
  const { created, id } = await deps.store.insertEvent({
    dedupe_key: `${article.id}:group-remainder`,
    legislator_id: null,
    raw_name: `${plan.count} unnamed ${chamberWord} members`,
    from_party: null,
    to_party: plan.toParty,
    event_type: "GROUP_DEFECTION",
    is_return: false,
    event_date: output.legislators[0]?.event_date ?? null,
    announced_date: (article.publishedAt ?? deps.today).slice(0, 10),
    chamber: plan.chamber,
    state: null,
    reason_given: null,
    confidence: 0,
    score_breakdown: {},
    status: "in_review",
    review_flags: ["unnamed_group_remainder"],
    evidence_quote: quote,
    reasoning_summary: output.reasoning_summary,
    model,
    prompt_version: PROMPT_VERSION,
  });
  if (!created) return `${plan.count} unnamed members: already recorded`;
  await deps.store.addSource(id, article.id, quote);
  result.events_created++;
  if (plan.toParty) {
    await deps.store.insertAlert({
      event_id: null,
      kind: "group_developing",
      level: "unverified",
      title: `Developing: ${plan.count} ${chamberWord} members reported to have joined ${plan.toParty}`,
      body: `Names not yet confirmed; party counts are unchanged. 1 source.`,
      is_fictional: namedFictional,
      dedupe_key: `group:${article.id}:developing`,
    });
  }
  return `${plan.count} unnamed members → review note${plan.toParty ? " + unverified alert" : ""}`;
}

/** Links a syndicated copy to the original's events without spending an LLM call. */
async function handleSyndicated(deps: DetectDeps, article: PendingArticle, originalId: number, result: DetectResult): Promise<string[]> {
  const lines: string[] = [];
  for (const event of await deps.store.eventsSourcedBy(originalId)) {
    const sources = [...(event.breakdown.sources ?? [])];
    const original = sources.find((s) => s.articleId === originalId);
    if (!original || sources.some((s) => s.articleId === article.id)) continue;
    // Same text, so it adds no independent corroboration, but its outlet may be a better tier.
    sources.push({ ...original, articleId: article.id, outlet: article.outlet, tier: tierFor(article.url, deps.sources) });
    await deps.store.addSource(event.id, article.id, event.quote);

    const entity = event.breakdown.entity;
    const match: MatchResult = {
      status: entity?.status ?? "NO_MATCH",
      legislator: null,
      score: entity?.score ?? 0,
      runnerUpScore: entity?.runnerUpScore ?? 0,
      flags: event.flags.filter((f) => f === "ambiguous_entity" || f === "unresolved_entity" || f === "party_mismatch"),
    };
    const assessment = assessEvent(
      { sources, match, extraFlags: event.flags.filter((f) => f === "denied"), toParty: event.toParty },
      deps.thresholds,
    );
    await deps.store.updateEvent(event.id, {
      confidence: assessment.breakdown.score,
      score_breakdown: { ...event.breakdown, ...assessment.breakdown, sources },
    });
    let outcome = event.status;
    if (event.status !== "published" && !event.reviewed && assessment.route.status === "published") {
      const legislator = deps.roster.find((r) => r.id === event.legislatorId) ?? null;
      outcome = await applyRoute(deps, event.id, event.status, assessment.route, legislator, event.toParty, sources.length, result);
    }
    lines.push(`syndicated copy added to event ${event.id} → ${outcome}`);
  }
  return lines;
}

export async function detect(deps: DetectDeps, articles?: PendingArticle[]): Promise<DetectResult> {
  const result: DetectResult = {
    articlesClassified: 0,
    llm_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    events_created: 0,
    events_published: 0,
    budgetExhausted: false,
    errors: [],
    decisions: [],
  };
  const queue = articles ?? (await deps.store.pendingArticles(deps.maxLlmCalls));
  const classifyDeps: ClassifyDeps = { ...deps.classify, canCall: () => result.llm_calls < deps.maxLlmCalls };

  for (const article of queue) {
    const decision: Decision = { articleId: article.id, title: article.title, classification: "", events: [] };
    try {
      if (!article.content) {
        decision.classification = "NO_TEXT";
        await deps.store.markArticle(article.id, "NO_TEXT");
        result.decisions.push(decision);
        continue;
      }
      const original = await deps.store.syndicatedFrom(article);
      if (original) {
        decision.classification = "DUPLICATE";
        decision.events = await handleSyndicated(deps, article, original.articleId, result);
        await deps.store.markArticle(article.id, "DUPLICATE");
        result.decisions.push(decision);
        continue;
      }

      const meta = articleMeta(article, deps);
      const userMessage = buildUserMessage(
        { title: article.title, outlet: article.outlet, url: article.url, publishedOn: meta.publishedOn, text: article.content },
        deps.isRelevant,
      );
      const classified = await classifyArticle(classifyDeps, userMessage);
      result.llm_calls += classified.usage.calls;
      result.input_tokens += classified.usage.inputTokens;
      result.output_tokens += classified.usage.outputTokens;

      if (classified.status === "budget") {
        result.budgetExhausted = true;
        result.errors.push({ where: "run", message: `LLM call budget (${deps.maxLlmCalls}) reached; remaining articles wait for the next run` });
        break;
      }
      if (classified.status === "error") {
        decision.classification = "ERROR";
        result.errors.push({ where: article.url, message: classified.error });
        await deps.store.markArticle(article.id, "ERROR");
        result.decisions.push(decision);
        continue;
      }

      const { output, model } = classified;
      result.articlesClassified++;
      decision.classification = output.classification;
      decision.model = model;
      const plans = planArticle(output, meta, deps.roster);
      const namedFictional = plans.some((p) => p.kind === "event" && p.match.legislator?.isFictional === true);
      for (const plan of plans) {
        if (plan.kind === "event") decision.events.push(await handleEvent(deps, plan, output, article, model, result));
        else if (plan.kind === "subject") decision.events.push(await handleSubject(deps, plan, article));
        else if (plan.kind === "group_remainder") {
          decision.events.push(await handleGroupRemainder(deps, plan, output, article, model, namedFictional, result));
        } else decision.events.push(`${plan.name}: dropped (${plan.reason})`);
      }
      await deps.store.markArticle(article.id, output.classification);
    } catch (error) {
      // Leave the article unmarked so the next run retries it.
      result.errors.push({ where: article.url, message: message(error) });
      decision.classification = "FAILED";
    }
    result.decisions.push(decision);
  }
  return result;
}
