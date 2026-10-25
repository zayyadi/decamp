import { describe, expect, it } from "vitest";
import { buildPrefilter } from "@/agent/filter";
import { contentHash } from "@/agent/ingest/extract";
import { HttpError, type FetchResult } from "@/agent/ingest/http";
import { ingestArticle, ingestFeeds, type IngestDeps } from "@/agent/ingest/ingest";
import type { ArticleRow, IngestStore } from "@/agent/ingest/store";
import type { Source } from "@/agent/sources";

const source = (key: string, feedUrl: string, homepage: string): Source => ({
  key,
  name: `Outlet ${key}`,
  feedUrl,
  homepage,
  tier: 1,
  review: { checked: "2026-10-25", robots: "test", terms: "test" },
});

const ALPHA = source("alpha", "https://alpha.example.org/feed", "https://alpha.example.org");
const BETA = source("beta", "https://beta.example.org/feed", "https://beta.example.org");

const LONG = " Background on the week in Abuja.".repeat(8);
const SINCE = new Date("2026-10-22T00:00:00Z");

interface ItemSpec {
  link: string;
  title: string;
  summary?: string;
  body?: string;
  date?: string;
}

function rss(items: ItemSpec[]): string {
  const xml = items
    .map(
      (i) => `<item>
        <title>${i.title}</title>
        <link>${i.link}</link>
        ${i.date === "" ? "" : `<pubDate>${new Date(i.date ?? "2026-10-24T10:00:00Z").toUTCString()}</pubDate>`}
        <description>${i.summary ?? LONG}</description>
        ${i.body ? `<content:encoded><![CDATA[<p>${i.body}</p>]]></content:encoded>` : ""}
      </item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>${xml}</channel></rss>`;
}

function articleHtml(text: string, canonical?: string): string {
  const para = `<p>${text} ${"More reporting from the National Assembly complex. ".repeat(6)}</p>`;
  return `<html><head><title>Story</title>${canonical ? `<link rel="canonical" href="${canonical}">` : ""}</head>
    <body><article>${para}${para}</article></body></html>`;
}

type Route = string | { body: string; type?: string } | Error;

function fakeHttp(routes: Record<string, Route>) {
  const gets: string[] = [];
  const http = {
    async get(url: string): Promise<FetchResult> {
      gets.push(url);
      const route = routes[url];
      if (route === undefined) throw new HttpError(url, 404);
      if (route instanceof Error) throw route;
      const { body, type } = typeof route === "string" ? { body: route, type: undefined } : route;
      return { url, status: 200, contentType: type ?? (body.startsWith("<?xml") ? "application/rss+xml" : "text/html"), body };
    },
  };
  return { http, gets };
}

/** Mirrors the database: url is unique and conflicting inserts are ignored. */
function memoryStore(): IngestStore & { rows: ArticleRow[] } {
  const rows: ArticleRow[] = [];
  return {
    rows,
    parties: async () => [
      { code: "APC", name: "All Progressives Congress", aliases: [] },
      { code: "PDP", name: "Peoples Democratic Party", aliases: [] },
    ],
    knownUrls: async (urls) => new Set(urls.filter((u) => rows.some((r) => r.url === u))),
    insertArticles: async (batch) => {
      const inserted = [];
      for (const row of batch) {
        if (rows.some((r) => r.url === row.url)) continue;
        rows.push(row);
        inserted.push({ url: row.url, prefilter_hit: row.prefilter_hit });
      }
      return inserted;
    },
    startRun: async () => 7,
    finishRun: async () => {},
  };
}

async function setup(routes: Record<string, Route>) {
  const store = memoryStore();
  const net = fakeHttp(routes);
  const deps: IngestDeps = {
    http: net.http,
    store,
    prefilter: buildPrefilter(await store.parties()),
    runId: 7,
  };
  return { store, net, deps };
}

describe("ingestFeeds", () => {
  it("stores every new item, keeping full text only for pre-filter hits", async () => {
    const { store, deps } = await setup({
      [ALPHA.feedUrl]: rss([
        { link: "https://alpha.example.org/hit?utm_source=rss", title: "Senator Barnabas Okeyode defects to APC" },
        { link: "https://alpha.example.org/miss", title: "Naira gains against the dollar" },
      ]),
      "https://alpha.example.org/hit": articleHtml("Senator Barnabas Okeyode defected to the APC on Tuesday."),
    });

    const result = await ingestFeeds(deps, [ALPHA], SINCE);

    expect(result).toMatchObject({ feeds_ok: 1, feeds_failed: 0, articles_new: 2, articles_prefiltered: 1, errors: [] });
    const [hit, miss] = store.rows;
    expect(hit).toMatchObject({
      url: "https://alpha.example.org/hit",
      outlet: "Outlet alpha",
      prefilter_hit: true,
      run_id: 7,
      published_at: "2026-10-24T10:00:00.000Z",
    });
    expect(hit.content).toContain("defected to the APC on Tuesday");
    expect(hit.content_hash).toBe(contentHash(hit.content ?? ""));
    expect(miss).toMatchObject({ prefilter_hit: false, content: null, content_hash: null });
  });

  it("is idempotent: a second run stores nothing and fetches no article pages", async () => {
    const { store, net, deps } = await setup({
      [ALPHA.feedUrl]: rss([{ link: "https://alpha.example.org/hit", title: "Senator defects to APC" }]),
      "https://alpha.example.org/hit": articleHtml("Senator defects to APC."),
    });
    await ingestFeeds(deps, [ALPHA], SINCE);
    net.gets.length = 0;

    const again = await ingestFeeds(deps, [ALPHA], SINCE);
    expect(again.articles_new).toBe(0);
    expect(store.rows).toHaveLength(1);
    expect(net.gets).toEqual([ALPHA.feedUrl]);
  });

  it("skips items older than the window but keeps undated ones", async () => {
    const { store, deps } = await setup({
      [ALPHA.feedUrl]: rss([
        { link: "https://alpha.example.org/old", title: "Old", date: "2026-10-01T00:00:00Z" },
        { link: "https://alpha.example.org/undated", title: "Undated", date: "" },
      ]),
    });
    await ingestFeeds(deps, [ALPHA], SINCE);
    expect(store.rows.map((r) => r.url)).toEqual(["https://alpha.example.org/undated"]);
  });

  it("records a failing feed and carries on with the others", async () => {
    const { store, deps } = await setup({
      [ALPHA.feedUrl]: new HttpError(ALPHA.feedUrl, 403),
      [BETA.feedUrl]: rss([{ link: "https://beta.example.org/story", title: "Story" }]),
    });
    const result = await ingestFeeds(deps, [ALPHA, BETA], SINCE);
    expect(result).toMatchObject({ feeds_ok: 1, feeds_failed: 1 });
    expect(result.errors).toEqual([{ where: "alpha", message: `HTTP 403 for ${ALPHA.feedUrl}` }]);
    expect(store.rows).toHaveLength(1);
  });

  it("records a feed that is not XML as failed", async () => {
    const { deps } = await setup({ [ALPHA.feedUrl]: "<html>Just a moment...</html>" });
    expect(await ingestFeeds(deps, [ALPHA], SINCE)).toMatchObject({ feeds_ok: 0, feeds_failed: 1 });
  });

  it("fetches the page to judge an item whose summary is short", async () => {
    const { store, net, deps } = await setup({
      [ALPHA.feedUrl]: rss([{ link: "https://alpha.example.org/short", title: "Big news", summary: "Read more" }]),
      "https://alpha.example.org/short": articleHtml("The senator representing Ondo Demo District 1 defected to the APC."),
    });
    await ingestFeeds(deps, [ALPHA], SINCE);
    expect(net.gets).toContain("https://alpha.example.org/short");
    expect(store.rows[0]).toMatchObject({ prefilter_hit: true });
  });

  it("uses the feed body instead of the page when the feed carries one", async () => {
    const { store, net, deps } = await setup({
      [ALPHA.feedUrl]: rss([
        {
          link: "https://alpha.example.org/short",
          title: "Weekend roundup",
          summary: "Read more",
          body: "Nothing about defections here.",
        },
      ]),
    });
    await ingestFeeds(deps, [ALPHA], SINCE);
    expect(net.gets).toEqual([ALPHA.feedUrl]);
    expect(store.rows[0]).toMatchObject({ prefilter_hit: false });
  });

  it("falls back to the feed body when a hit's page is refused", async () => {
    const link = "https://alpha.example.org/blocked";
    const { store, deps } = await setup({
      [ALPHA.feedUrl]: rss([{ link, title: "Senator defects to PDP", body: "Senator Okeyode defected to the PDP." }]),
      [link]: new HttpError(link, 403),
    });
    const result = await ingestFeeds(deps, [ALPHA], SINCE);
    expect(store.rows[0]).toMatchObject({ prefilter_hit: true, content: "Senator Okeyode defected to the PDP." });
    expect(result.errors).toEqual([{ where: link, message: `HTTP 403 for ${link}` }]);
  });

  it("does not keep a page that is not HTML", async () => {
    const link = "https://alpha.example.org/report.pdf";
    const { store, deps } = await setup({
      [ALPHA.feedUrl]: rss([{ link, title: "Senator defects to APC" }]),
      [link]: { body: "%PDF-1.7", type: "application/pdf" },
    });
    const result = await ingestFeeds(deps, [ALPHA], SINCE);
    expect(store.rows[0]).toMatchObject({ prefilter_hit: true, content: null });
    expect(result.errors[0].message).toMatch(/not HTML/);
  });

  it("stores a hit under its same-site rel=canonical, once", async () => {
    const canonical = "https://alpha.example.org/politics/okeyode";
    const { store, deps } = await setup({
      [ALPHA.feedUrl]: rss([
        { link: "https://alpha.example.org/amp/okeyode", title: "Senator defects to APC" },
        { link: "https://alpha.example.org/okeyode-2", title: "Senator defects to APC (update)" },
      ]),
      "https://alpha.example.org/amp/okeyode": articleHtml("Senator defects to APC.", canonical),
      "https://alpha.example.org/okeyode-2": articleHtml("Senator defects to APC.", canonical),
    });
    const result = await ingestFeeds(deps, [ALPHA], SINCE);
    expect(store.rows.map((r) => r.url)).toEqual([canonical]);
    expect(result.articles_new).toBe(1);
  });
});

describe("ingestArticle", () => {
  it("ingests a single page and names its outlet", async () => {
    const url = "https://beta.example.org/story";
    const { store, deps } = await setup({
      [url]: articleHtml("Senator Barnabas Okeyode has defected from the PDP to the APC."),
    });
    const result = await ingestArticle(deps, `${url}?utm_source=x`, [ALPHA, BETA]);
    expect(result).toMatchObject({ articles_new: 1, articles_prefiltered: 1 });
    expect(store.rows[0]).toMatchObject({ url, outlet: "Outlet beta", prefilter_hit: true });
  });

  it("uses the host as the outlet for an unconfigured site", async () => {
    const url = "https://elsewhere.example.net/story";
    const { store, deps } = await setup({ [url]: articleHtml("Nothing to see.") });
    await ingestArticle(deps, url, [ALPHA]);
    expect(store.rows[0]).toMatchObject({ outlet: "elsewhere.example.net", prefilter_hit: false });
  });

  it("rejects a non-HTTP URL", async () => {
    const { deps } = await setup({});
    await expect(ingestArticle(deps, "ftp://example.org/x", [])).rejects.toThrow(/not an http/);
  });
});
