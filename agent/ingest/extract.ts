import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { collapseWhitespace } from "./text";

export interface ExtractedPage {
  text: string;
  title: string | null;
  /** Absolute `<link rel="canonical">` href, if the page has one. */
  canonical: string | null;
  publishedAt: Date | null;
}

/** Article text from a page. jsdom runs no scripts and loads no subresources by default. */
export function extractPage(html: string, url: string): ExtractedPage {
  // Silence jsdom's CSS and markup complaints about real-world pages.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const { document } = dom.window;
    const canonicalEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const published = document
      .querySelector('meta[property="article:published_time"]')
      ?.getAttribute("content");
    const publishedAt = published ? new Date(published) : null;

    // Readability mutates the document, so read metadata first.
    const article = new Readability(document).parse();
    const text = collapseWhitespace(article?.textContent ?? document.body?.textContent ?? "");

    return {
      text,
      title: article?.title?.trim() || null,
      canonical: canonicalEl?.href || null,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    };
  } finally {
    dom.window.close();
  }
}

/** Syndicated copies differ in whitespace and case, so hash a normalised form. */
export function contentHash(text: string): string {
  return createHash("sha256").update(collapseWhitespace(text).toLowerCase()).digest("hex");
}
