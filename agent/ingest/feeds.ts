import { XMLParser } from "fast-xml-parser";
import { htmlToText } from "./text";

export interface FeedItem {
  /** As published in the feed; canonicalise before use. */
  link: string;
  title: string;
  summary: string;
  /** Full body when the feed carries one (`content:encoded`, Atom `content`). */
  body: string | null;
  publishedAt: Date | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

/** Text of an element that may be a string, a node with `#text`, or a list. */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return text(value[0]);
  if (isNode(value) && typeof value["#text"] === "string") return value["#text"];
  return "";
}

function date(value: unknown): Date | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function list(value: unknown): Node[] {
  if (Array.isArray(value)) return value.filter(isNode);
  return isNode(value) ? [value] : [];
}

function atomLink(links: unknown): string {
  const all = Array.isArray(links) ? links : [links];
  for (const link of all) {
    if (isNode(link)) {
      const rel = link["@_rel"];
      if ((rel === undefined || rel === "alternate") && typeof link["@_href"] === "string") {
        return link["@_href"];
      }
    } else if (typeof link === "string" && link.trim()) {
      return link;
    }
  }
  return "";
}

function rssItem(item: Node): FeedItem {
  const encoded = text(item["content:encoded"]);
  return {
    link: text(item.link).trim() || text(item.guid).trim(),
    title: htmlToText(text(item.title)),
    summary: htmlToText(text(item.description)),
    body: encoded ? htmlToText(encoded) : null,
    publishedAt: date(item.pubDate) ?? date(item["dc:date"]),
  };
}

function atomEntry(entry: Node): FeedItem {
  const content = text(entry.content);
  return {
    link: atomLink(entry.link).trim(),
    title: htmlToText(text(entry.title)),
    summary: htmlToText(text(entry.summary)),
    body: content ? htmlToText(content) : null,
    publishedAt: date(entry.published) ?? date(entry.updated),
  };
}

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom. Items without a link are dropped. */
export function parseFeed(xml: string): FeedItem[] {
  const doc: unknown = parser.parse(xml);
  if (!isNode(doc)) throw new Error("feed is not XML");

  let items: FeedItem[];
  if (isNode(doc.rss)) {
    const channel = list(doc.rss.channel)[0];
    items = list(channel?.item).map(rssItem);
  } else if (isNode(doc["rdf:RDF"])) {
    items = list(doc["rdf:RDF"].item).map(rssItem);
  } else if (isNode(doc.feed)) {
    items = list(doc.feed.entry).map(atomEntry);
  } else {
    throw new Error("not an RSS or Atom feed");
  }
  return items.filter((item) => item.link !== "");
}
