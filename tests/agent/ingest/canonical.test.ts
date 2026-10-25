import { describe, expect, it } from "vitest";
import { canonicalUrl, preferCanonical } from "@/agent/ingest/canonical";

describe("canonicalUrl", () => {
  it.each([
    ["https://Example.ORG/news/story/", "https://example.org/news/story"],
    ["https://example.org/story?utm_source=rss&utm_medium=web", "https://example.org/story"],
    ["https://example.org/story?id=7&fbclid=abc&gclid=x", "https://example.org/story?id=7"],
    ["https://example.org/story#comments", "https://example.org/story"],
    ["https://example.org:443/story", "https://example.org/story"],
    ["https://example.org/", "https://example.org"],
    ["https://example.org/%e2%82%a6-story", "https://example.org/%E2%82%A6-story"],
    ["  https://example.org/story  ", "https://example.org/story"],
  ])("%s → %s", (raw, expected) => {
    expect(canonicalUrl(raw)).toBe(expected);
  });

  it("keeps a query it does not need to change byte-for-byte", () => {
    expect(canonicalUrl("https://example.org/a?q=b%20c&p=1")).toBe("https://example.org/a?q=b%20c&p=1");
  });

  it("resolves relative links against a base", () => {
    expect(canonicalUrl("/story/", "https://example.org/feed")).toBe("https://example.org/story");
  });

  it.each(["not a url", "mailto:desk@example.org", "javascript:alert(1)", ""])(
    "rejects %j",
    (raw) => {
      expect(canonicalUrl(raw)).toBeNull();
    },
  );

  it("maps the same story reached through different links to one URL", () => {
    const a = canonicalUrl("https://EXAMPLE.org/story/?utm_campaign=x#top");
    const b = canonicalUrl("https://example.org/story");
    expect(a).toBe(b);
  });
});

describe("preferCanonical", () => {
  it("uses the page's canonical link on the same site", () => {
    expect(preferCanonical("https://example.org/amp/story", "https://www.example.org/story/")).toBe(
      "https://www.example.org/story",
    );
  });

  it("ignores a canonical link on another site", () => {
    expect(preferCanonical("https://example.org/story", "https://other.example.net/story")).toBe(
      "https://example.org/story",
    );
  });

  it("keeps the URL when there is no canonical link", () => {
    expect(preferCanonical("https://example.org/story", null)).toBe("https://example.org/story");
  });
});
