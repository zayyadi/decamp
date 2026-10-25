// Canonical URL rules (AGENT.md §2). `articles.url` is unique, so the same story
// reached through two links must canonicalise to one string.

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid)$/i;

export function canonicalUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const tracking = [...url.searchParams.keys()].filter((k) => TRACKING_PARAM.test(k));
  // Re-serialising the query changes its encoding, so leave untouched queries as-is.
  let search = url.search;
  if (tracking.length > 0) {
    for (const key of tracking) url.searchParams.delete(key);
    const rest = url.searchParams.toString();
    search = rest ? `?${rest}` : "";
  }

  // `origin` lowercases the host and drops default ports and credentials.
  // Feeds and rel=canonical disagree on the case of escapes (%e2 vs %E2).
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${search}`.replace(
    /%[0-9a-f]{2}/gi,
    (escape) => escape.toUpperCase(),
  );
}

const site = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/**
 * Prefer the page's `<link rel="canonical">`, but only on the same site: a
 * canonical pointing elsewhere would let a page claim another outlet's URL.
 */
export function preferCanonical(url: string, relCanonical: string | null): string {
  if (!relCanonical) return url;
  const candidate = canonicalUrl(relCanonical, url);
  return candidate && site(candidate) === site(url) ? candidate : url;
}
