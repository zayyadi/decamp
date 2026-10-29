import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/format";
import { alertHref, isFresh, mergeAlerts, parseAlert, type LiveAlert } from "@/lib/realtime";

const alert = (id: number, created_at: string, over: Partial<LiveAlert> = {}): LiveAlert => ({
  id,
  event_id: "6f1c0e7a-0000-4000-8000-000000000001",
  kind: "published",
  level: "confirmed",
  title: `Alert ${id}`,
  body: "Confirmed. 1 source.",
  created_at,
  ...over,
});

describe("parseAlert", () => {
  it("accepts a Realtime row, coercing the bigint id", () => {
    expect(parseAlert({ ...alert(7, "2026-10-25T10:00:00Z"), id: "7", dedupe_key: "event:x:published", is_fictional: true })).toEqual(
      alert(7, "2026-10-25T10:00:00Z"),
    );
  });

  it("drops malformed rows", () => {
    expect(parseAlert({ id: 1, level: "rumour" })).toBeNull();
    expect(parseAlert(null)).toBeNull();
  });
});

describe("mergeAlerts", () => {
  it("dedupes by id, keeps newest first and caps the list", () => {
    const server = [alert(2, "2026-10-25T10:02:00Z"), alert(1, "2026-10-25T10:01:00Z")];
    const live = [alert(3, "2026-10-25T10:03:00Z"), alert(2, "2026-10-25T10:02:00Z")];
    expect(mergeAlerts(server, live).map((a) => a.id)).toEqual([3, 2, 1]);
    expect(mergeAlerts(server, live, 2).map((a) => a.id)).toEqual([3, 2]);
  });

  it("orders alerts created in the same instant by id", () => {
    const same = "2026-10-25T10:00:00Z";
    expect(mergeAlerts([alert(4, same)], [alert(5, same)]).map((a) => a.id)).toEqual([5, 4]);
  });
});

describe("alertHref", () => {
  it("links confirmed events to their page and everything else to the feed", () => {
    expect(alertHref(alert(1, "x"))).toBe("/events/6f1c0e7a-0000-4000-8000-000000000001");
    expect(alertHref(alert(1, "x", { level: "unverified", kind: "developing" }))).toBe("/#alerts");
    expect(alertHref(alert(1, "x", { kind: "correction" }))).toBe("/#alerts");
    expect(alertHref(alert(1, "x", { event_id: null, kind: "group_developing", level: "unverified" }))).toBe("/#alerts");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  it("reads like a feed", () => {
    expect(relativeTime("2026-10-25T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-25T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-10-25T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-23T12:00:00Z", now)).toBe("2 days ago");
  });

  it("never shows a live arrival as in the future", () => {
    expect(relativeTime("2026-10-25T12:00:40Z", now)).toBe("just now");
  });
});

describe("isFresh", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  it("toasts alerts from the last day only", () => {
    expect(isFresh(alert(1, "2026-10-29T11:59:00Z"), now)).toBe(true);
    expect(isFresh(alert(2, "2026-10-28T12:00:00Z"), now)).toBe(true);
  });
  it("skips a backfilled alert dated to its historical event", () => {
    expect(isFresh(alert(3, "2024-03-05T00:00:00+00:00"), now)).toBe(false);
  });
});
