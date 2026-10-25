import { describe, expect, it } from "vitest";
import { contentHash, extractPage } from "@/agent/ingest/extract";

const paragraph =
  "Senator Barnabas Okeyode, who represents Ondo Demo District 1, on Tuesday formally announced " +
  "his defection from the Peoples Democratic Party to the All Progressives Congress. ";

const page = `<!doctype html>
<html>
<head>
  <title>Okeyode defects to APC | Example Daily</title>
  <link rel="canonical" href="/politics/okeyode-defects/">
  <meta property="article:published_time" content="2026-10-20T10:30:00+01:00">
  <script>window.tracker = true;</script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/politics">Politics</a></nav>
  <article>
    <h1>Okeyode defects to APC</h1>
    <p>${paragraph.repeat(3)}</p>
    <p>${paragraph.repeat(3)}</p>
  </article>
  <footer>Copyright Example Daily</footer>
</body>
</html>`;

describe("extractPage", () => {
  const extracted = extractPage(page, "https://example.org/politics/okeyode-defects/?utm_source=x");

  it("returns the article text without navigation or footer", () => {
    expect(extracted.text).toContain("formally announced his defection");
    expect(extracted.text).not.toContain("Copyright");
    expect(extracted.text).not.toMatch(/\s{2,}/);
  });

  it("resolves the canonical link to an absolute URL", () => {
    expect(extracted.canonical).toBe("https://example.org/politics/okeyode-defects/");
  });

  it("reads the publication time", () => {
    expect(extracted.publishedAt).toEqual(new Date("2026-10-20T09:30:00Z"));
  });

  it("reads the title", () => {
    expect(extracted.title).toMatch(/Okeyode defects to APC/);
  });

  it("copes with a page that has no article", () => {
    expect(extractPage("<html><body></body></html>", "https://example.org/")).toMatchObject({
      text: "",
      canonical: null,
      publishedAt: null,
    });
  });
});

describe("contentHash", () => {
  it("ignores whitespace and case, so syndicated copies collide", () => {
    expect(contentHash("Senator  Okeyode\ndefects")).toBe(contentHash("senator okeyode defects"));
  });

  it("differs for different text", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});
