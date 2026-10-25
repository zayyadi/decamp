import { needsBody, type FilterInput } from "@/agent/filter";
import { sourceForUrl, type Source } from "@/agent/sources";
import { canonicalUrl, preferCanonical } from "./canonical";
import { contentHash, extractPage, type ExtractedPage } from "./extract";
import { parseFeed, type FeedItem } from "./feeds";
import type { FetchResult } from "./http";
import type { ArticleRow, IngestStore, RunSummary } from "./store";

// Ingest stage (AGENT.md §1, S0–S3): fetch feeds → canonicalise and skip known
// URLs → keyword pre-filter → fetch and extract pages that pass → store.

export interface Fetcher {
  get(url: string): Promise<FetchResult>;
}

export interface IngestDeps {
  http: Fetcher;
  store: IngestStore;
  prefilter: (input: FilterInput) => boolean;
  runId: number | null;
}

export interface Decision {
  outlet: string;
  url: string;
  title: string;
  prefilterHit: boolean;
  pageFetched: boolean;
  contentChars: number;
  /** False when the URL was already stored (e.g. under its rel=canonical). */
  stored: boolean;
}

export interface IngestResult
  extends Required<Pick<RunSummary, "feeds_ok" | "feeds_failed" | "articles_new" | "articles_prefiltered" | "errors">> {
  decisions: Decision[];
  /** `--article` only: the page as extracted, so it can be classified even when nothing is stored. */
  article?: { url: string; outlet: string; title: string; publishedAt: string | null; text: string; contentHash: string };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const emptyResult = (): IngestResult => ({
  feeds_ok: 0,
  feeds_failed: 0,
  articles_new: 0,
  articles_prefiltered: 0,
  errors: [],
  decisions: [],
});

interface LoadedPage {
  page: ExtractedPage;
  finalUrl: string;
}

/** Fetches an article page at most once, and only if something asks for it. */
class PageLoader {
  private pending: Promise<LoadedPage | null> | undefined;

  constructor(
    private readonly http: Fetcher,
    private readonly url: string,
    private readonly result: IngestResult,
    preloaded?: LoadedPage,
  ) {
    if (preloaded) this.pending = Promise.resolve(preloaded);
  }

  get fetched(): boolean {
    return this.pending !== undefined;
  }

  load(): Promise<LoadedPage | null> {
    this.pending ??= this.http.get(this.url).then(
      (res) => {
        if (!/html/i.test(res.contentType)) throw new Error(`not HTML (${res.contentType || "no type"})`);
        return { page: extractPage(res.body, res.url), finalUrl: res.url };
      },
    ).catch((error: unknown) => {
      this.result.errors.push({ where: this.url, message: message(error) });
      return null;
    });
    return this.pending;
  }
}

async function buildRow(
  deps: IngestDeps,
  outlet: string,
  url: string,
  item: FeedItem,
  pages: PageLoader,
): Promise<{ row: ArticleRow; decision: Omit<Decision, "stored"> }> {
  let body = item.body;
  if (needsBody(item.summary) && !body) body = (await pages.load())?.page.text ?? null;

  const hit = deps.prefilter({ title: item.title, summary: item.summary, body });
  // Only articles that may be defections are kept in full; they feed the classifier.
  if (hit) await pages.load();
  const loaded = pages.fetched ? await pages.load() : null;
  const content = hit ? loaded?.page.text || body || null : null;

  const storedUrl = loaded ? preferCanonical(url, loaded.page.canonical ?? loaded.finalUrl) : url;
  const title = item.title || loaded?.page.title || storedUrl;
  const publishedAt = item.publishedAt ?? loaded?.page.publishedAt ?? null;

  return {
    row: {
      url: storedUrl,
      outlet,
      title,
      published_at: publishedAt?.toISOString() ?? null,
      content,
      content_hash: content ? contentHash(content) : null,
      prefilter_hit: hit,
      run_id: deps.runId,
    },
    decision: {
      outlet,
      url: storedUrl,
      title,
      prefilterHit: hit,
      pageFetched: pages.fetched,
      contentChars: content?.length ?? 0,
    },
  };
}

async function store(
  deps: IngestDeps,
  built: { row: ArticleRow; decision: Omit<Decision, "stored"> }[],
  result: IngestResult,
): Promise<void> {
  // Two feed links can share a rel=canonical; keep the first.
  const unique = new Map(built.map((b) => [b.row.url, b] as const));
  const inserted = await deps.store.insertArticles([...unique.values()].map((b) => b.row));
  const insertedUrls = new Set(inserted.map((r) => r.url));

  result.articles_new += inserted.length;
  result.articles_prefiltered += inserted.filter((r) => r.prefilter_hit).length;
  for (const { decision } of built) {
    result.decisions.push({ ...decision, stored: insertedUrls.has(decision.url) });
  }
}

async function ingestSource(
  deps: IngestDeps,
  source: Source,
  since: Date,
  result: IngestResult,
): Promise<void> {
  let items: FeedItem[];
  try {
    items = parseFeed((await deps.http.get(source.feedUrl)).body);
    result.feeds_ok++;
  } catch (error) {
    result.feeds_failed++;
    result.errors.push({ where: source.key, message: message(error) });
    return;
  }

  const fresh = new Map<string, FeedItem>();
  for (const item of items) {
    const url = canonicalUrl(item.link, source.feedUrl);
    // Undated items are kept; the unique URL stops them repeating.
    if (!url || (item.publishedAt && item.publishedAt < since)) continue;
    if (!fresh.has(url)) fresh.set(url, item);
  }

  const known = await deps.store.knownUrls([...fresh.keys()]);
  const built = [];
  for (const [url, item] of fresh) {
    if (known.has(url)) continue;
    built.push(await buildRow(deps, source.name, url, item, new PageLoader(deps.http, url, result)));
  }
  await store(deps, built, result);
}

/** One pass over every feed. A failing feed is recorded and skipped. */
export async function ingestFeeds(
  deps: IngestDeps,
  sources: Source[],
  since: Date,
): Promise<IngestResult> {
  const result = emptyResult();
  // Sources run concurrently; the fetcher keeps each host to its own pace.
  await Promise.all(
    sources.map((source) =>
      ingestSource(deps, source, since, result).catch((error: unknown) => {
        result.errors.push({ where: source.key, message: message(error) });
      }),
    ),
  );
  return result;
}

/** `--article=<url>`: ingest a single page, whatever its age or source. */
export async function ingestArticle(
  deps: IngestDeps,
  rawUrl: string,
  sources: Source[],
): Promise<IngestResult> {
  const url = canonicalUrl(rawUrl);
  if (!url) throw new Error(`not an http(s) URL: ${rawUrl}`);
  const result = emptyResult();

  const res = await deps.http.get(url);
  const loaded = { page: extractPage(res.body, res.url), finalUrl: res.url };
  const outlet = sourceForUrl(url, sources)?.name ?? new URL(url).hostname;
  const item: FeedItem = {
    link: url,
    title: loaded.page.title ?? "",
    summary: "",
    body: loaded.page.text,
    publishedAt: loaded.page.publishedAt,
  };

  const built = await buildRow(deps, outlet, url, item, new PageLoader(deps.http, url, result, loaded));
  await store(deps, [built], result);
  result.article = {
    url: built.row.url,
    outlet,
    title: built.row.title,
    publishedAt: built.row.published_at,
    text: loaded.page.text,
    contentHash: contentHash(loaded.page.text),
  };
  return result;
}
