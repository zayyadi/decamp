"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import type { ActionState } from "@/app/admin/actions";

/** Inline result of an admin action; successes also toast, since the item may vanish from the list. */
export function ActionMessage({ state }: { state: ActionState }) {
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
  }, [state]);
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {state.message}
    </p>
  );
}
