"use client";

import { ArrowRightIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/badges";
import { alertHref, mergeAlerts, parseAlert, type LiveAlert } from "@/lib/realtime";
import { getBrowserClient } from "@/lib/supabase/browser";

export type LiveStatus = "connecting" | "live" | "offline";

const LiveContext = createContext<{ alerts: LiveAlert[]; status: LiveStatus }>({ alerts: [], status: "connecting" });
export const useLive = () => useContext(LiveContext);

// Several changes land together when an event is published (the event update,
// then its alert); one refresh covers them.
const REFRESH_DELAY_MS = 300;

function AlertToast({ alert, onClose }: { alert: LiveAlert; onClose: () => void }) {
  const confirmed = alert.level === "confirmed";
  return (
    <div
      className={`flex w-[min(24rem,calc(100vw-2rem))] gap-3 rounded-xl border p-4 shadow-lg ${
        confirmed ? "border-primary/30 bg-card" : "border-unverified-border bg-unverified"
      }`}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <StatusBadge level={alert.level} />
        <p className={`text-sm leading-snug font-semibold ${confirmed ? "text-card-foreground" : "text-unverified-foreground"}`}>{alert.title}</p>
        <p className={`text-xs ${confirmed ? "text-muted-foreground" : "text-unverified-foreground/90"}`}>{alert.body}</p>
        <Link
          href={alertHref(alert)}
          onClick={onClose}
          className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline ${confirmed ? "text-highlight" : "text-unverified-foreground"}`}
        >
          {confirmed && alert.kind !== "correction" ? "See the event" : "See latest alerts"} <ArrowRightIcon className="size-3.5" aria-hidden />
        </Link>
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="self-start rounded-md p-0.5 text-muted-foreground hover:text-foreground">
        <XIcon className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Site-wide Realtime subscriber (SPEC §6.4): a toast for each new alert, the
 * alert handed to the live feed, and a refresh so server-rendered charts and
 * counts update. RLS on the server decides what this anon socket receives.
 */
export function LiveUpdates({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const refreshTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const supabase = getBrowserClient();
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
    };

    const channel = supabase
      .channel("decampwatch-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, (payload) => {
        const alert = parseAlert(payload.new);
        if (!alert) return;
        setAlerts((prev) => mergeAlerts(prev, [alert]));
        toast.custom((id) => <AlertToast alert={alert} onClose={() => toast.dismiss(id)} />, {
          id: `alert-${alert.id}`,
          duration: alert.level === "confirmed" ? 10_000 : 8_000,
        });
        scheduleRefresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "defection_events" }, scheduleRefresh)
      // TIMED_OUT is retried by the client, so it still counts as connecting.
      .subscribe((s) => setStatus(s === "SUBSCRIBED" ? "live" : s === "TIMED_OUT" ? "connecting" : "offline"));

    return () => {
      window.clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return <LiveContext value={{ alerts, status }}>{children}</LiveContext>;
}
