import { describe, expect, it } from "vitest";
import { HttpError, PoliteFetcher, RobotsDisallowed, userAgentFor } from "@/agent/ingest/http";

type Reply = Response | Error | (() => Response | Error);

/** A fake network: each URL answers from a queue of replies; the last reply repeats. */
function fakeNetwork(routes: Record<string, Reply | Reply[]>) {
  const calls: { url: string; at: number; userAgent: string | null }[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, at: clock, userAgent: new Headers(init?.headers).get("user-agent") });
    const queue = queues.get(url);
    if (!queue) return new Response("not found", { status: 404 });
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    const reply = typeof next === "function" ? next() : next;
    if (reply instanceof Error) throw reply;
    return reply.clone();
  };

  const fetcher = new PoliteFetcher({
    userAgent: userAgentFor("https://example.org/contact"),
    fetch: fetchFn,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { fetcher, calls, sleeps, urls: () => calls.map((c) => c.url) };
}

const ok = (body: string, type = "text/html") =>
  new Response(body, { status: 200, headers: { "content-type": type } });
const robots = (text: string) => ok(text, "text/plain");
const status = (code: number) => new Response(null, { status: code });
const redirect = (to: string) => new Response(null, { status: 301, headers: { location: to } });

describe("PoliteFetcher", () => {
  it("identifies itself and checks robots.txt first", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/a": ok("A"),
    });
    const res = await net.fetcher.get("https://example.org/a");
    expect(res).toMatchObject({ url: "https://example.org/a", status: 200, body: "A" });
    expect(net.urls()).toEqual(["https://example.org/robots.txt", "https://example.org/a"]);
    expect(net.calls.every((c) => c.userAgent === "DecampWatchBot/1.0 (+https://example.org/contact)")).toBe(true);
  });

  it("refuses a URL robots.txt disallows, without requesting it", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots("User-agent: *\nDisallow: /private/"),
    });
    await expect(net.fetcher.get("https://example.org/private/x")).rejects.toBeInstanceOf(RobotsDisallowed);
    expect(net.urls()).toEqual(["https://example.org/robots.txt"]);
  });

  it("treats a site that refuses robots.txt as off limits", async () => {
    const net = fakeNetwork({ "https://example.org/robots.txt": status(403) });
    await expect(net.fetcher.get("https://example.org/a")).rejects.toBeInstanceOf(RobotsDisallowed);
  });

  it("spaces requests to one host by at least a second", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/a": ok("A"),
      "https://example.org/b": ok("B"),
    });
    await Promise.all([net.fetcher.get("https://example.org/a"), net.fetcher.get("https://example.org/b")]);
    const times = net.calls.map((c) => c.at);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it("honours a longer Crawl-delay", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots("User-agent: *\nCrawl-delay: 10"),
      "https://example.org/a": ok("A"),
      "https://example.org/b": ok("B"),
    });
    await net.fetcher.get("https://example.org/a");
    await net.fetcher.get("https://example.org/b");
    const [, a, b] = net.calls.map((c) => c.at);
    expect(b - a).toBe(10_000);
  });

  it("does not make one host wait for another", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/a": ok("A"),
      "https://example.net/robots.txt": robots(""),
      "https://example.net/a": ok("A"),
    });
    await Promise.all([net.fetcher.get("https://example.org/a"), net.fetcher.get("https://example.net/a")]);
    const firstAt = (url: string) => net.calls.find((c) => c.url === url)?.at;
    expect(firstAt("https://example.org/robots.txt")).toBe(0);
    expect(firstAt("https://example.net/robots.txt")).toBe(0);
  });

  it("retries 5xx twice with backoff, then succeeds", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/a": [status(503), status(502), ok("A")],
    });
    expect((await net.fetcher.get("https://example.org/a")).body).toBe("A");
    expect(net.urls().filter((u) => u.endsWith("/a"))).toHaveLength(3);
    expect(net.sleeps).toEqual(expect.arrayContaining([2000, 4000]));
  });

  it("gives up after two retries", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/a": status(503),
    });
    await expect(net.fetcher.get("https://example.org/a")).rejects.toMatchObject({ status: 503 });
    expect(net.urls().filter((u) => u.endsWith("/a"))).toHaveLength(3);
  });

  it("retries network errors, then rethrows", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/a": new TypeError("fetch failed"),
    });
    await expect(net.fetcher.get("https://example.org/a")).rejects.toThrow("fetch failed");
    expect(net.urls().filter((u) => u.endsWith("/a"))).toHaveLength(3);
  });

  it("does not retry a 404", async () => {
    const net = fakeNetwork({ "https://example.org/robots.txt": robots("") });
    await expect(net.fetcher.get("https://example.org/missing")).rejects.toBeInstanceOf(HttpError);
    expect(net.urls().filter((u) => u.endsWith("/missing"))).toHaveLength(1);
  });

  it("checks robots.txt again when a redirect changes host", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/feed": redirect("https://feeds.example.org/latest"),
      "https://feeds.example.org/robots.txt": robots("User-agent: *\nDisallow: /"),
    });
    await expect(net.fetcher.get("https://example.org/feed")).rejects.toBeInstanceOf(RobotsDisallowed);
    expect(net.urls()).not.toContain("https://feeds.example.org/latest");
  });

  it("follows allowed redirects and reports the final URL", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/old": redirect("/new"),
      "https://example.org/new": ok("moved"),
    });
    expect(await net.fetcher.get("https://example.org/old")).toMatchObject({
      url: "https://example.org/new",
      body: "moved",
    });
  });

  it("stops after five redirects", async () => {
    const net = fakeNetwork({
      "https://example.org/robots.txt": robots(""),
      "https://example.org/loop": redirect("/loop"),
    });
    await expect(net.fetcher.get("https://example.org/loop")).rejects.toThrow(/redirects/);
  });
});
