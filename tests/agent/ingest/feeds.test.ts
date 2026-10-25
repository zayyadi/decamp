import { describe, expect, it } from "vitest";
import { parseFeed } from "@/agent/ingest/feeds";
import { htmlToText } from "@/agent/ingest/text";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Daily</title>
    <item>
      <title>Senator Barnabas Okeyode defects to APC</title>
      <link>https://example.org/okeyode-defects/?utm_source=rss</link>
      <pubDate>Sun, 25 Oct 2026 14:47:38 +0000</pubDate>
      <description><![CDATA[<p>The senator&#8217;s letter was read at plenary &amp; noted.</p>]]></description>
      <content:encoded><![CDATA[<p>Full body.</p><script>track()</script><p>Second paragraph.</p>]]></content:encoded>
    </item>
    <item>
      <title>Item without a date</title>
      <link>https://example.org/undated</link>
      <description>Plain &lt;b&gt;escaped&lt;/b&gt; HTML</description>
    </item>
    <item>
      <title>Item without a link</title>
    </item>
  </channel>
</rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <entry>
    <title type="html">Lawmaker joins ADC</title>
    <link rel="self" href="https://example.org/self"/>
    <link rel="alternate" href="https://example.org/atom-story"/>
    <published>2026-10-24T09:00:00Z</published>
    <summary>Short summary</summary>
    <content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
  </entry>
</feed>`;

const rdf = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>Example RDF</title></channel>
  <item>
    <title>RDF story</title>
    <link>https://example.org/rdf-story</link>
    <dc:date>2026-10-23T08:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

describe("parseFeed", () => {
  it("reads RSS 2.0 items, turning HTML into text", () => {
    const [first, second] = parseFeed(rss);
    expect(first).toEqual({
      link: "https://example.org/okeyode-defects/?utm_source=rss",
      title: "Senator Barnabas Okeyode defects to APC",
      summary: "The senator’s letter was read at plenary & noted.",
      body: "Full body. Second paragraph.",
      publishedAt: new Date("2026-10-25T14:47:38Z"),
    });
    expect(second).toMatchObject({ summary: "Plain escaped HTML", body: null, publishedAt: null });
  });

  it("drops items without a link", () => {
    expect(parseFeed(rss)).toHaveLength(2);
  });

  it("reads Atom entries and picks the alternate link", () => {
    expect(parseFeed(atom)).toEqual([
      {
        link: "https://example.org/atom-story",
        title: "Lawmaker joins ADC",
        summary: "Short summary",
        body: "Atom body",
        publishedAt: new Date("2026-10-24T09:00:00Z"),
      },
    ]);
  });

  it("reads RSS 1.0 (RDF) items", () => {
    expect(parseFeed(rdf)).toMatchObject([
      { link: "https://example.org/rdf-story", publishedAt: new Date("2026-10-23T08:00:00Z") },
    ]);
  });

  it("rejects something that is not a feed", () => {
    expect(() => parseFeed("<html><body>Blocked</body></html>")).toThrow(/not an RSS or Atom feed/);
  });
});

describe("htmlToText", () => {
  it("strips tags, scripts and comments and decodes entities", () => {
    expect(htmlToText("<p>A&nbsp;&ldquo;quote&rdquo;</p><!-- x --><style>p{}</style>&#x20A6;5bn")).toBe(
      "A “quote” ₦5bn",
    );
  });
});
