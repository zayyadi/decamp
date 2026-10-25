import { isPublishable, type Classification } from "@/agent/classify/schema";

// Eval metrics (AGENT.md §7). Pure, so they are unit-tested on their own.

export const TARGETS = { confirmedPrecision: 0.95, recall: 0.85, entityAccuracy: 0.95 };

export interface ExpectedLegislator {
  /** Roster full name, or null for a person who is not on the roster. */
  roster_id: string | null;
  from: string | null;
  to: string | null;
}

export interface PredictedEvent {
  /** Resolved roster full name, or null when the match was not UNIQUE. */
  rosterId: string | null;
  toParty: string | null;
  status: "published" | "in_review" | "rejected";
}

export interface FixtureOutcome {
  id: string;
  expectedClass: Classification;
  expectedLegislators: ExpectedLegislator[];
  /** "ERROR" when classification failed. */
  predictedClass: Classification | "ERROR";
  events: PredictedEvent[];
}

const isRight = (e: PredictedEvent, expected: ExpectedLegislator[]) =>
  e.rosterId !== null && expected.some((x) => x.roster_id === e.rosterId && x.to === e.toParty);

export interface Metrics {
  published: number;
  confirmedPrecision: number;
  expectedDefections: number;
  recall: number;
  resolvedEvents: number;
  entityAccuracy: number;
  perClass: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  confusion: Record<string, Record<string, number>>;
  failures: string[];
}

export function computeMetrics(outcomes: FixtureOutcome[]): Metrics {
  const failures: string[] = [];

  // Of events routed to publish, the share that are a completed defection by the right legislator.
  let published = 0;
  let publishedRight = 0;
  // Completed defections that end up published or in review with the right legislator.
  let expectedDefections = 0;
  let found = 0;
  // Of events in fixtures that expect a defection, the share resolved correctly
  // (to the expected member, or left unresolved when the expected person is off-roster).
  let resolvedEvents = 0;
  let resolvedRight = 0;

  for (const o of outcomes) {
    const expectsEvent = isPublishable(o.expectedClass);
    for (const e of o.events) {
      if (e.status === "published") {
        published++;
        if (expectsEvent && isRight(e, o.expectedLegislators)) publishedRight++;
        else failures.push(`${o.id}: published a wrong event (${e.rosterId ?? "unresolved"} → ${e.toParty})`);
      }
      if (expectsEvent) {
        resolvedEvents++;
        const offRoster = o.expectedLegislators.some((x) => x.roster_id === null);
        if (e.rosterId === null ? offRoster : o.expectedLegislators.some((x) => x.roster_id === e.rosterId)) {
          resolvedRight++;
        } else {
          failures.push(`${o.id}: resolved to ${e.rosterId ?? "nobody"}`);
        }
      }
    }
    if (expectsEvent) {
      for (const x of o.expectedLegislators) {
        if (x.roster_id === null) continue;
        expectedDefections++;
        const hit = o.events.some((e) => e.status !== "rejected" && e.rosterId === x.roster_id && e.toParty === x.to);
        if (hit) found++;
        else failures.push(`${o.id}: missed ${x.roster_id} → ${x.to}`);
      }
    }
    if (o.predictedClass !== o.expectedClass) {
      failures.push(`${o.id}: expected ${o.expectedClass}, got ${o.predictedClass}`);
    }
  }

  const confusion: Record<string, Record<string, number>> = {};
  for (const o of outcomes) {
    confusion[o.expectedClass] ??= {};
    confusion[o.expectedClass][o.predictedClass] = (confusion[o.expectedClass][o.predictedClass] ?? 0) + 1;
  }

  const classes = new Set<string>([...outcomes.map((o) => o.expectedClass), ...outcomes.map((o) => o.predictedClass)]);
  const perClass: Metrics["perClass"] = {};
  for (const c of classes) {
    const tp = outcomes.filter((o) => o.expectedClass === c && o.predictedClass === c).length;
    const predicted = outcomes.filter((o) => o.predictedClass === c).length;
    const support = outcomes.filter((o) => o.expectedClass === c).length;
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[c] = { precision, recall, f1, support };
  }

  return {
    published,
    // Nothing published means nothing published wrongly.
    confirmedPrecision: published ? publishedRight / published : 1,
    expectedDefections,
    recall: expectedDefections ? found / expectedDefections : 1,
    resolvedEvents,
    entityAccuracy: resolvedEvents ? resolvedRight / resolvedEvents : 1,
    perClass,
    confusion,
    failures,
  };
}

export function meetsTargets(m: Metrics): boolean {
  return (
    m.confirmedPrecision >= TARGETS.confirmedPrecision &&
    m.recall >= TARGETS.recall &&
    m.entityAccuracy >= TARGETS.entityAccuracy
  );
}
