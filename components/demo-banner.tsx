import { FlaskConicalIcon } from "lucide-react";
import { getDemoMode, getHistoricalCoverage } from "@/lib/queries/dashboard";
import { formatDate } from "@/lib/format";

/** Shown whenever fictional rows are visible, so demo data can't pass for real. */
export async function DemoBanner() {
  const [demo, coverage] = await Promise.all([getDemoMode(), getHistoricalCoverage()]);
  if (!demo && !coverage) return null;
  return (
    <div role="note" className="border-b border-unverified-border bg-unverified text-unverified-foreground">
      <p className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-2 text-sm sm:px-6">
        <FlaskConicalIcon className="size-4 shrink-0" aria-hidden />
        <span>
          {demo ? <><strong>Demo mode.</strong> Fictional legislators and defections are shown alongside any real records.</> : coverage ? <>
            <strong>Historical preview.</strong> Sourced Senate and House defections since June 2023.
            {" "}Partial backfill; latest included event: {formatDate(coverage.latest_event)}.
            {" "}Party totals cover recorded members, not the full National Assembly.
          </> : null}
        </span>
      </p>
    </div>
  );
}
