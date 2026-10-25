import { FlaskConicalIcon } from "lucide-react";
import { getDemoMode } from "@/lib/queries/dashboard";

/** Shown whenever fictional rows are visible, so demo data can't pass for real. */
export async function DemoBanner() {
  if (!(await getDemoMode())) return null;
  return (
    <div role="note" className="border-b border-unverified-border bg-unverified text-unverified-foreground">
      <p className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-2 text-sm sm:px-6">
        <FlaskConicalIcon className="size-4 shrink-0" aria-hidden />
        <span>
          <strong>Demo mode.</strong> Fictional legislators and defections are shown. None of these people or events
          are real.
        </span>
      </p>
    </div>
  );
}
