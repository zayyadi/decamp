import { describe, expect, it } from "vitest";
import { sourceForUrl, sources } from "@/agent/sources";

describe("sources", () => {
  it("have unique keys", () => {
    expect(new Set(sources.map((s) => s.key)).size).toBe(sources.length);
  });

  it.each(sources)("$key has a tier, HTTPS URLs and a robots/terms review", (source) => {
    expect([1, 2, 3]).toContain(source.tier);
    expect(new URL(source.feedUrl).protocol).toBe("https:");
    expect(new URL(source.homepage).protocol).toBe("https:");
    expect(source.review.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(source.review.robots.length).toBeGreaterThan(0);
    expect(source.review.terms.length).toBeGreaterThan(0);
  });
});

describe("sourceForUrl", () => {
  it("matches the homepage site with or without www and on subdomains", () => {
    expect(sourceForUrl("https://punchng.com/some-story")?.key).toBe("punch");
    expect(sourceForUrl("https://rss.punchng.com/v1/feed")?.key).toBe("punch");
    expect(sourceForUrl("https://premiumtimesng.com/news/1")?.key).toBe("premium-times");
  });

  it("does not match a lookalike domain", () => {
    expect(sourceForUrl("https://notpunchng.com/story")).toBeUndefined();
  });
});
