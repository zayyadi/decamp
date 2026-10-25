import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRobots, ROBOTS_TTL_MS, RobotsCache, type RobotsSnapshot } from "@/agent/ingest/robots";

const ROBOTS_URL = "https://example.org/robots.txt";
const snap = (status: number, body = ""): RobotsSnapshot => ({ fetchedAt: 0, status, body });

const body = `
User-agent: *
Disallow: /search/
Crawl-delay: 10

User-agent: DecampWatchBot
Disallow: /private/
Crawl-delay: 2

User-agent: BadBot
Disallow: /
`;

describe("parseRobots", () => {
  it("applies the group for our product token", () => {
    const rules = parseRobots(ROBOTS_URL, snap(200, body), "DecampWatchBot");
    expect(rules.isAllowed("https://example.org/private/x")).toBe(false);
    expect(rules.isAllowed("https://example.org/search/x")).toBe(true);
    expect(rules.crawlDelay).toBe(2);
  });

  it("falls back to the * group", () => {
    const rules = parseRobots(ROBOTS_URL, snap(200, "User-agent: *\nDisallow: /search/\nCrawl-delay: 10"), "DecampWatchBot");
    expect(rules.isAllowed("https://example.org/search/x")).toBe(false);
    expect(rules.isAllowed("https://example.org/news/1")).toBe(true);
    expect(rules.crawlDelay).toBe(10);
  });

  it("never allows a URL on another host", () => {
    const rules = parseRobots(ROBOTS_URL, snap(200, ""), "DecampWatchBot");
    expect(rules.isAllowed("https://other.example.net/x")).toBe(false);
  });

  it.each([404, 410])("treats %i as no rules", (status) => {
    expect(parseRobots(ROBOTS_URL, snap(status), "DecampWatchBot").isAllowed("https://example.org/a")).toBe(true);
  });

  it.each([0, 401, 403, 429, 500, 503])("treats %i as disallow all", (status) => {
    expect(parseRobots(ROBOTS_URL, snap(status), "DecampWatchBot").isAllowed("https://example.org/a")).toBe(false);
  });
});

describe("RobotsCache", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function counting(status = 200, text = "User-agent: *\nDisallow: /no/") {
    const calls: string[] = [];
    let clock = 0;
    const cache = (file?: string) =>
      new RobotsCache({
        userAgent: "DecampWatchBot",
        now: () => clock,
        file,
        load: async (url) => {
          calls.push(url);
          return { fetchedAt: clock, status, body: text };
        },
      });
    return { calls, cache, tick: (ms: number) => (clock += ms) };
  }

  it("fetches robots.txt once per origin within 24 h", async () => {
    const { calls, cache, tick } = counting();
    const robots = cache();
    await Promise.all([robots.rules("https://example.org/a"), robots.rules("https://example.org/b")]);
    tick(ROBOTS_TTL_MS - 1);
    await robots.rules("https://example.org/c");
    expect(calls).toEqual([ROBOTS_URL]);

    tick(1);
    await robots.rules("https://example.org/d");
    expect(calls).toEqual([ROBOTS_URL, ROBOTS_URL]);
  });

  it("keeps origins apart", async () => {
    const { calls, cache } = counting();
    const robots = cache();
    await robots.rules("https://example.org/a");
    await robots.rules("https://news.example.org/a");
    expect(calls).toEqual([ROBOTS_URL, "https://news.example.org/robots.txt"]);
  });

  it("persists snapshots between processes", async () => {
    dir = mkdtempSync(join(tmpdir(), "robots-"));
    const file = join(dir, "nested", "robots.json");
    const first = counting();
    const writer = first.cache(file);
    expect((await writer.rules("https://example.org/no/x")).isAllowed("https://example.org/no/x")).toBe(false);
    writer.save();

    const second = counting(200, "");
    const reader = second.cache(file);
    expect((await reader.rules("https://example.org/no/x")).isAllowed("https://example.org/no/x")).toBe(false);
    expect(second.calls).toEqual([]);
  });
});
