"use client";

import { useActionState } from "react";
import { reverseEvent } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionMessage } from "./action-message";

/** Reversal undoes the party change and publishes the note as a correction, so the note is required. */
export function ReverseForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(reverseEvent, null);
  return (
    <form action={action} className="space-y-2" aria-busy={pending}>
      <input type="hidden" name="event_id" value={eventId} />
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Public correction note
        <Input name="note" required minLength={10} maxLength={1000} placeholder="e.g. The member's office says the report was wrong" className="bg-card" />
      </label>
      <ActionMessage state={state} />
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        Reverse and publish correction
      </Button>
    </form>
  );
}
