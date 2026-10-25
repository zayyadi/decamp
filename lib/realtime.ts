import { z } from "zod";

// Realtime payloads (SPEC §6.4) are checked like any other input before they
// reach the UI; a malformed row is dropped rather than rendered.

export const liveAlertSchema = z.object({
  id: z.coerce.number(),
  event_id: z.string().nullable(),
  kind: z.enum(["published", "developing", "correction", "group_developing"]),
  level: z.enum(["confirmed", "unverified"]),
  title: z.string(),
  body: z.string(),
  created_at: z.string(),
});
export type LiveAlert = z.infer<typeof liveAlertSchema>;

export function parseAlert(raw: unknown): LiveAlert | null {
  const parsed = liveAlertSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Newest first, one entry per id: live arrivals overlap the server list after a refresh. */
export function mergeAlerts(server: LiveAlert[], live: LiveAlert[], limit = 20): LiveAlert[] {
  const byId = new Map<number, LiveAlert>();
  for (const a of [...server, ...live]) byId.set(a.id, a);
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
    .slice(0, limit);
}

/**
 * Where an alert leads. Only confirmed events are public; unverified ones and
 * group alerts point at the feed instead of a page the visitor can't open.
 */
export function alertHref(a: Pick<LiveAlert, "level" | "kind" | "event_id">): string {
  return a.level === "confirmed" && a.kind !== "correction" && a.event_id ? `/events/${a.event_id}` : "/#alerts";
}
