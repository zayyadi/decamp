import { RobotsCache, type RobotsSnapshot } from "./robots";

// Politeness rules: AGENT.md §2 and CLAUDE.md rule 6.

export const BOT_NAME = "DecampWatchBot";
const MAX_REDIRECTS = 5;

export const userAgentFor = (contactUrl: string) => `${BOT_NAME}/1.0 (+${contactUrl})`;

export interface FetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export class RobotsDisallowed extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows ${url}`);
  }
}

export interface PoliteFetcherOptions {
  userAgent: string;
  /** Persist robots.txt snapshots between runs. */
  robotsFile?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  retries?: number;
  minIntervalMs?: number;
  backoffMs?: number;
}

interface RawResponse {
  status: number;
  location: string | null;
  contentType: string;
  body: string;
}

export class PoliteFetcher {
  readonly robots: RobotsCache;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly lastRequest = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly options: PoliteFetcherOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
    this.robots = new RobotsCache({
      userAgent: BOT_NAME,
      load: (url) => this.loadRobots(url),
      now: this.now,
      file: options.robotsFile,
    });
  }

  /** GET a URL, checking robots.txt for it and for every redirect hop. Non-2xx throws. */
  async get(url: string): Promise<FetchResult> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const rules = await this.robots.rules(current);
      if (!rules.isAllowed(current)) throw new RobotsDisallowed(current);

      const res = await this.request(current, rules.crawlDelay, "manual");
      if (res.status >= 300 && res.status < 400 && res.location) {
        current = new URL(res.location, current).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new HttpError(current, res.status);
      return { url: current, status: res.status, contentType: res.contentType, body: res.body };
    }
    throw new Error(`more than ${MAX_REDIRECTS} redirects from ${url}`);
  }

  private async loadRobots(robotsUrl: string): Promise<RobotsSnapshot> {
    const fetchedAt = this.now();
    try {
      // RFC 9309 says to follow robots.txt redirects.
      const res = await this.request(robotsUrl, undefined, "follow");
      return { fetchedAt, status: res.status, body: res.body };
    } catch {
      return { fetchedAt, status: 0, body: "" };
    }
  }

  private async request(
    url: string,
    crawlDelaySeconds: number | undefined,
    redirect: RequestRedirect,
  ): Promise<RawResponse> {
    const {
      userAgent,
      timeoutMs = 10_000,
      retries = 2,
      minIntervalMs = 1_000,
      backoffMs = 2_000,
    } = this.options;
    const host = new URL(url).host;
    const interval = Math.max(minIntervalMs, (crawlDelaySeconds ?? 0) * 1000);

    for (let attempt = 0; ; attempt++) {
      await this.throttle(host, interval);
      try {
        const res = await this.fetchFn(url, {
          redirect,
          headers: { "user-agent": userAgent },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < retries) {
          await res.body?.cancel();
          await this.sleep(backoffMs * 2 ** attempt);
          continue;
        }
        return {
          status: res.status,
          location: res.headers.get("location"),
          contentType: res.headers.get("content-type") ?? "",
          body: await res.text(),
        };
      } catch (error) {
        if (attempt >= retries) throw error;
        await this.sleep(backoffMs * 2 ** attempt);
      }
    }
  }

  /** Serialises requests per host and spaces their starts by `intervalMs`. */
  private async throttle(host: string, intervalMs: number): Promise<void> {
    const previous = this.queues.get(host) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => (release = resolve));
    this.queues.set(host, previous.then(() => turn));
    await previous;
    try {
      const last = this.lastRequest.get(host);
      const wait = last === undefined ? 0 : last + intervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequest.set(host, this.now());
    } finally {
      release();
    }
  }
}
