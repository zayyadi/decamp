"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { relativeTime } from "@/lib/format";
import { alertHref, mergeAlerts, type LiveAlert } from "@/lib/realtime";
import { useLive } from "./live-updates";

/**
 * The 20 most recent alerts: the server's list plus anything Realtime
 * delivered since. `now` comes from the server render so times match on
 * hydration.
 */
export function LiveAlertFeed({ initial, now }: { initial: LiveAlert[]; now: number }) {
  const { alerts: live } = useLive();
  const alerts = mergeAlerts(initial, live);
  if (alerts.length === 0) return <p className="text-sm text-muted-foreground">No alerts yet.</p>;
  return (
    <ol className="divide-y" aria-live="polite" aria-relevant="additions">
      {alerts.map((a) => {
        const href = alertHref(a);
        return (
          <li key={a.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge level={a.level} />
              <time dateTime={a.created_at} className="text-xs text-muted-foreground">
                {relativeTime(a.created_at, now)}
              </time>
            </div>
            <p className="text-sm leading-snug font-medium">
              {href !== "/#alerts" ? (
                <Link href={href} className="hover:text-primary hover:underline">
                  {a.title}
                </Link>
              ) : (
                a.title
              )}
            </p>
            <p className="text-xs text-muted-foreground">{a.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

const LABEL = { live: "Live", connecting: "Connecting", offline: "Offline" } as const;

/** Text plus a dot, so the connection state never relies on colour. */
export function LiveStatusBadge() {
  const { status } = useLive();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground" title="Updates arrive without reloading">
      <span
        aria-hidden
        className={`size-2 rounded-full ${status === "live" ? "animate-pulse bg-confirmed" : status === "offline" ? "bg-destructive" : "bg-unverified-border"}`}
      />
      {LABEL[status]}
    </span>
  );
}
