import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import robotsParser from "robots-parser";

export const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

/** What we fetched for a host's robots.txt. `status` 0 means a network failure. */
export interface RobotsSnapshot {
  fetchedAt: number;
  status: number;
  body: string;
}

export interface RobotsRules {
  isAllowed(url: string): boolean;
  /** Seconds between requests asked for by the site, if any. */
  crawlDelay: number | undefined;
}

/**
 * 2xx: obey the file. 404/410 and other 4xx: no file, so everything is allowed.
 * 401/403, 429, 5xx and network failures: the site is refusing us or is
 * unwell, so we fetch nothing from it this time (stricter than RFC 9309,
 * which allows 401/403 to be read as "no rules").
 */
export function parseRobots(
  robotsUrl: string,
  snapshot: RobotsSnapshot,
  userAgent: string,
): RobotsRules {
  const { status, body } = snapshot;
  if (status >= 200 && status < 300) {
    const robot = robotsParser(robotsUrl, body);
    return {
      // An undefined answer means the URL is on another host; never allow it.
      isAllowed: (url) => robot.isAllowed(url, userAgent) === true,
      crawlDelay: robot.getCrawlDelay(userAgent),
    };
  }
  const blocked = status === 0 || status === 401 || status === 403 || status === 429 || status >= 500;
  return { isAllowed: () => !blocked, crawlDelay: undefined };
}

export type RobotsLoader = (robotsUrl: string) => Promise<RobotsSnapshot>;

/**
 * Per-origin robots.txt, kept for 24 h (AGENT.md §2). Each agent run is a
 * fresh process, so snapshots can be persisted to a file between runs.
 */
export class RobotsCache {
  private readonly snapshots = new Map<string, RobotsSnapshot>();
  private readonly pending = new Map<string, Promise<RobotsSnapshot>>();

  constructor(
    private readonly options: {
      userAgent: string;
      load: RobotsLoader;
      now?: () => number;
      file?: string;
    },
  ) {
    if (options.file) this.restore(options.file);
  }

  async rules(url: string): Promise<RobotsRules> {
    const robotsUrl = `${new URL(url).origin}/robots.txt`;
    return parseRobots(robotsUrl, await this.snapshot(robotsUrl), this.options.userAgent);
  }

  private async snapshot(robotsUrl: string): Promise<RobotsSnapshot> {
    const now = (this.options.now ?? Date.now)();
    const cached = this.snapshots.get(robotsUrl);
    if (cached && now - cached.fetchedAt < ROBOTS_TTL_MS) return cached;

    let inflight = this.pending.get(robotsUrl);
    if (!inflight) {
      inflight = this.options.load(robotsUrl).finally(() => this.pending.delete(robotsUrl));
      this.pending.set(robotsUrl, inflight);
    }
    const fresh = await inflight;
    this.snapshots.set(robotsUrl, fresh);
    return fresh;
  }

  save(): void {
    const { file } = this.options;
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(Object.fromEntries(this.snapshots), null, 2));
  }

  private restore(file: string): void {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return;
      for (const [key, value] of Object.entries(parsed)) {
        if (isSnapshot(value)) this.snapshots.set(key, value);
      }
    } catch {
      // A corrupt cache only costs a refetch.
    }
  }
}

function isSnapshot(value: unknown): value is RobotsSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.fetchedAt === "number" && typeof v.status === "number" && typeof v.body === "string";
}
