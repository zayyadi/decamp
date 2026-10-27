import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { LlmClient } from "@/agent/classify/classify";
import { classifierOutputSchema, type ClassifierOutput } from "@/agent/classify/schema";
import {
  detect,
  type DetectDeps,
  type DetectStore,
  type NewAlert,
  type NewEvent,
  type PendingArticle,
  type StoredEvent,
} from "@/agent/detect";
import type { Source } from "@/agent/sources";
import { legislator, output } from "./classify/output";
import { fictionalRoster, PARTY_CODES } from "./roster";

const roster = fictionalRoster();

const source = (key: string, tier: 1 | 2 | 3): Source => ({
  key,
  name: key,
  feedUrl: `https://${key}.example.org/feed`,
  homepage: `https://${key}.example.org`,
  tier,
  review: { checked: "2026-10-25", robots: "test", terms: "test" },
});
const SOURCES = [source("tierone", 1), source("tiertwo", 2), source("othertwo", 2)];

const QUOTE = "I have today joined the APC";

function article(id: number, host: string, over: Partial<PendingArticle> = {}): PendingArticle {
  return {
    id,
    url: `https://${host}.example.org/story-${id}`,
    outlet: host,
    title: `Story ${id}`,
    publishedAt: "2026-09-15T09:00:00Z",
    content: `Senator Barnabas Okeyode of Ondo Demo District 1 spoke on Monday. "${QUOTE}," he said.`,
    contentHash: `hash-${id}`,
    ...over,
  };
}

/** Mirrors the database's unique keys and publish_defection's checks. */
class MemoryStore implements DetectStore {
  events = new Map<string, StoredEvent & { row: NewEvent; note?: string }>();
  sources: { eventId: string; articleId: number; quote: string }[] = [];
  alerts = new Map<string, NewAlert>();
  marked = new Map<number, string>();
  published: string[] = [];
  refuse: string | null = null;
  pending: PendingArticle[] = [];
  classified = new Map<string, number>();

  async pendingArticles() {
    return this.pending.filter((a) => !this.marked.has(a.id));
  }
  async syndicatedFrom(a: PendingArticle) {
    const id = a.contentHash ? this.classified.get(a.contentHash) : undefined;
    return id !== undefined && id !== a.id ? { articleId: id, classification: "CONFIRMED_DEFECTION" } : null;
  }
  async eventsSourcedBy(articleId: number) {
    return this.sources
      .filter((s) => s.articleId === articleId)
      .map((s) => ({ ...this.events.get(s.eventId)!, quote: s.quote }));
  }
  async eventsFor(legislatorId: string) {
    return [...this.events.values()].filter((e) => e.legislatorId === legislatorId);
  }
  async insertEvent(row: NewEvent) {
    const existing = [...this.events.values()].find((e) => e.row.dedupe_key === row.dedupe_key);
    if (existing) return { id: existing.id, created: false };
    const id = `ev${this.events.size + 1}`;
    this.events.set(id, {
      id,
      row,
      legislatorId: row.legislator_id,
      toParty: row.to_party,
      eventDate: row.event_date,
      createdAt: "2026-09-15T10:00:00Z",
      status: row.status,
      flags: row.review_flags,
      reviewed: false,
      breakdown: row.score_breakdown,
    });
    return { id, created: true };
  }
  async addSource(eventId: string, articleId: number, quote: string) {
    if (!this.sources.some((s) => s.eventId === eventId && s.articleId === articleId)) {
      this.sources.push({ eventId, articleId, quote });
    }
  }
  async updateEvent(id: string, patch: Parameters<DetectStore["updateEvent"]>[1]) {
    const e = this.events.get(id)!;
    if (patch.status) e.status = patch.status;
    if (patch.review_flags) e.flags = patch.review_flags;
    if (patch.score_breakdown) e.breakdown = patch.score_breakdown;
    if (patch.review_note) e.note = patch.review_note;
  }
  async publish(id: string) {
    if (this.refuse) return this.refuse;
    const e = this.events.get(id)!;
    if (e.status === "published") return null;
    e.status = "published";
    this.published.push(id);
    return null;
  }
  async insertAlert(alert: NewAlert) {
    if (!this.alerts.has(alert.dedupe_key)) this.alerts.set(alert.dedupe_key, alert);
  }
  async markArticle(id: number, classification: string) {
    this.marked.set(id, classification);
    const a = this.pending.find((p) => p.id === id);
    if (a?.contentHash && !["ERROR", "NO_TEXT", "DUPLICATE"].includes(classification)) this.classified.set(a.contentHash, id);
  }
}

/** Replies by article title, so each test controls what "the model" says. */
function fakeLlm(byTitle: Record<string, ClassifierOutput>, calls: { n: number }): LlmClient {
  return async (request) => {
    calls.n++;
    const prompt = String(request.messages[0].content);
    const title = Object.keys(byTitle).find((t) => prompt.includes(`<article>\n${t}\n`));
    if (!title) throw new Error("unexpected article");
    const text = JSON.stringify(byTitle[title]);
    return {
      content: [{ type: "text", text, citations: null } as Anthropic.TextBlock],
      text,
      stopReason: "end_turn",
      inputTokens: 1000,
      outputTokens: 200,
    };
  };
}

let store: MemoryStore;
let calls: { n: number };

function deps(byTitle: Record<string, ClassifierOutput>, over: Partial<DetectDeps> = {}): DetectDeps {
  return {
    store,
    roster,
    classify: {
      llm: fakeLlm(byTitle, calls),
      classifierModel: "small",
      escalationModel: "large",
      system: "system",
      schema: classifierOutputSchema(PARTY_CODES),
    },
    isRelevant: () => true,
    thresholds: { publish: 0.85, review: 0.6 },
    maxLlmCalls: 60,
    sources: SOURCES,
    today: "2026-09-16",
    ...over,
  };
}

const reported = output({ legislators: [legislator({ evidence_type: "reported_completed_act" })] });

beforeEach(() => {
  store = new MemoryStore();
  calls = { n: 0 };
});

describe("detect", () => {
  it("publishes a strong single-source defection through publish_defection", async () => {
    const a = article(1, "tierone");
    const r = await detect(deps({ "Story 1": output() }), [a]);

    expect(r).toMatchObject({ articlesClassified: 1, llm_calls: 1, events_created: 1, events_published: 1, errors: [] });
    const [event] = store.events.values();
    expect(event).toMatchObject({ status: "published", legislatorId: "Barnabas Okeyode" });
    expect(event.row).toMatchObject({
      dedupe_key: "1:Barnabas Okeyode",
      from_party: "PDP",
      to_party: "APC",
      event_type: "CONFIRMED_DEFECTION",
      state: "Ondo",
      chamber: "senate",
      // 0.35·0.95 + 0.2·1 + 0.2·1 + 0.15·0.3 + 0.1·1 = 0.8775, half up
      confidence: 0.878,
      model: "small",
      prompt_version: expect.any(String),
    });
    expect(store.sources).toEqual([{ eventId: event.id, articleId: 1, quote: QUOTE }]);
    // publish_defection inserts the confirmed alert itself.
    expect(store.alerts.size).toBe(0);
    expect(store.marked.get(1)).toBe("CONFIRMED_DEFECTION");
  });

  it("sends a weaker report to review with an unverified alert, without touching counts", async () => {
    const r = await detect(deps({ "Story 1": reported }), [article(1, "tiertwo")]);
    const [event] = store.events.values();
    expect(event.status).toBe("in_review");
    expect(store.published).toEqual([]);
    expect(r.events_published).toBe(0);
    const [alert] = store.alerts.values();
    expect(alert).toMatchObject({
      event_id: event.id,
      kind: "developing",
      level: "unverified",
      title: "Developing: reports say Sen. Barnabas Okeyode has defected to APC",
      is_fictional: true,
      dedupe_key: `event:${event.id}:developing`,
    });
  });

  it("promotes an event to published when an independent outlet corroborates it", async () => {
    await detect(deps({ "Story 1": reported }), [article(1, "tiertwo")]);
    const r = await detect(deps({ "Story 2": output() }), [article(2, "tierone")]);

    expect(store.events.size).toBe(1);
    const [event] = store.events.values();
    expect(event.status).toBe("published");
    expect(event.breakdown.sources?.map((s) => s.articleId)).toEqual([1, 2]);
    expect(event.breakdown.K).toBe(0.8);
    expect(r.decisions[0].events[0]).toMatch(/corroborates event ev1 → published/);
  });

  it("is idempotent when the same article is processed again", async () => {
    const a = article(1, "tiertwo");
    await detect(deps({ "Story 1": reported }), [a]);
    await detect(deps({ "Story 1": reported }), [a]);
    expect(store.events.size).toBe(1);
    expect(store.sources).toHaveLength(1);
    expect(store.alerts.size).toBe(1);
  });

  it("flags a denial and keeps the event in review", async () => {
    await detect(deps({ "Story 1": reported }), [article(1, "tiertwo")]);
    const denial = output({
      classification: "DENIAL",
      checks: { ...output().checks, act_status: "denied" },
      legislators: [legislator({ to_party: null, evidence_type: "vague" })],
    });
    await detect(deps({ "Story 2": denial }), [article(2, "tierone")]);
    const [event] = store.events.values();
    expect(event.status).toBe("in_review");
    expect(event.flags).toContain("denied");
    expect(event.breakdown.counterEvidence).toEqual([{ articleId: 2, classification: "DENIAL", quote: QUOTE }]);
  });

  it("never reverses a published event on a denial, but flags it for an editor", async () => {
    await detect(deps({ "Story 1": output() }), [article(1, "tierone")]);
    const denial = output({ classification: "DENIAL", legislators: [legislator({ to_party: null })] });
    await detect(deps({ "Story 2": denial }), [article(2, "tiertwo")]);
    const [event] = store.events.values();
    expect(event.status).toBe("published");
    expect(event.flags).toEqual(expect.arrayContaining(["denied", "denied_after_publish"]));
  });

  it("records unnamed group members as a review note with a group alert", async () => {
    const group = output({
      classification: "GROUP_DEFECTION",
      certainty: 0.93,
      checks: { ...output().checks, is_plenary_announcement: true },
      unnamed_count: 2,
      legislators: [
        legislator({ name_as_written: "Hon. Ekpenyong Bassey-Ita", chamber: "house", state: "Rivers", constituency: null, evidence_type: "plenary_letter" }),
      ],
    });
    await detect(deps({ "Story 1": group }), [article(1, "tierone", { content: `Story text. "${QUOTE}"` })]);
    const remainder = [...store.events.values()].find((e) => e.row.dedupe_key === "1:group-remainder");
    expect(remainder).toMatchObject({ status: "in_review", legislatorId: null, flags: ["unnamed_group_remainder"] });
    expect(remainder?.row.raw_name).toBe("2 unnamed House members");
    expect(store.alerts.get("group:1:developing")).toMatchObject({
      event_id: null,
      kind: "group_developing",
      title: "Developing: 2 House members reported to have joined APC",
    });
  });

  it("links a syndicated copy without an LLM call and without counting it as independent", async () => {
    store.pending = [article(1, "tiertwo", { contentHash: "same" }), article(2, "tierone", { contentHash: "same" })];
    await detect(deps({ "Story 1": reported }));
    expect(calls.n).toBe(1);
    expect(store.marked.get(2)).toBe("DUPLICATE");
    const [event] = store.events.values();
    expect(store.sources.map((s) => s.articleId)).toEqual([1, 2]);
    // Better tier, but the same text: K stays at one outlet.
    expect(event.breakdown).toMatchObject({ T: 1, K: 0.3 });
  });

  it("moves an event to review when publish_defection refuses it", async () => {
    store.refuse = "cannot publish: legislator is already in the destination party";
    await detect(deps({ "Story 1": output() }), [article(1, "tierone")]);
    const [event] = store.events.values();
    expect(event.status).toBe("in_review");
    expect(event.note).toMatch(/already in the destination party/);
  });

  it("drops a defection by a former member", async () => {
    const former = output({ legislators: [legislator({ name_as_written: "Sen. Idris Ocheja-Fictional", state: "Kogi", from_party: "PDP" })] });
    const r = await detect(deps({ "Story 1": former }), [article(1, "tierone")]);
    expect(store.events.size).toBe(0);
    expect(r.decisions[0].events[0]).toMatch(/dropped \(matches former member/);
  });

  it("keeps an unresolved name in review without an alert", async () => {
    const unknown = output({ legislators: [legislator({ name_as_written: "Senator Kunle Adeboye-Fictional", state: "Osun" })] });
    await detect(deps({ "Story 1": unknown }), [article(1, "tierone")]);
    const [event] = store.events.values();
    expect(event).toMatchObject({ status: "in_review", legislatorId: null });
    expect(event.flags).toContain("unresolved_entity");
    expect(store.alerts.size).toBe(0);
  });

  it("sends a state-assembly defection to review with its state, even when the report is strong", async () => {
    const assembly = output({
      classification: "FORMAL_PLENARY_ANNOUNCEMENT",
      legislators: [
        legislator({ name_as_written: "Hon. Yakubu Tanko-Fictional", chamber: "state_assembly", state: "Kano", constituency: "Fagge", evidence_type: "plenary_letter" }),
      ],
    });
    const r = await detect(deps({ "Story 1": assembly }), [article(1, "tierone")]);
    expect(r.events_published).toBe(0);
    const [event] = store.events.values();
    expect(event).toMatchObject({ status: "in_review", legislatorId: null });
    expect(event.row).toMatchObject({ chamber: "state_assembly", state: "Kano" });
    expect(event.flags).toEqual(expect.arrayContaining(["unresolved_entity", "state_assembly"]));
  });

  it("stores no state an editor would have to undo when the article's state isn't a real one", async () => {
    const odd = output({ legislators: [legislator({ name_as_written: "Hon. Nobody-Fictional", chamber: "state_assembly", state: "Kano State" })] });
    await detect(deps({ "Story 1": odd }), [article(1, "tierone")]);
    const [event] = store.events.values();
    expect(event.row).toMatchObject({ chamber: "state_assembly", state: null });
  });

  it("flags a quote that is not in the article", async () => {
    const paraphrase = output({ legislators: [legislator({ evidence_quote: "I am now in the APC" })] });
    await detect(deps({ "Story 1": paraphrase }), [article(1, "tierone")]);
    const [event] = store.events.values();
    expect(event.status).toBe("in_review");
    expect(event.flags).toContain("quote_not_verbatim");
  });

  it("marks an article without text instead of classifying it", async () => {
    await detect(deps({}), [article(1, "tierone", { content: null })]);
    expect(store.marked.get(1)).toBe("NO_TEXT");
    expect(calls.n).toBe(0);
  });

  it("marks an article ERROR when the model's output never validates", async () => {
    const r = await detect(deps({ "Story 1": output({ legislators: [] }) }), [article(1, "tierone")]);
    expect(store.marked.get(1)).toBe("ERROR");
    expect(r.errors[0].message).toMatch(/needs at least one legislator/);
  });

  it("stops at the call budget and leaves the rest for the next run", async () => {
    store.pending = [article(1, "tierone"), article(2, "tierone")];
    const r = await detect(deps({ "Story 1": output(), "Story 2": output() }, { maxLlmCalls: 1 }));
    expect(r.budgetExhausted).toBe(true);
    expect(store.marked.has(1)).toBe(true);
    expect(store.marked.has(2)).toBe(false);
  });
});
