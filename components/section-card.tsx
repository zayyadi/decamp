import { TableIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A dashboard panel. `table` is the accessible alternative to the chart
 * (SPEC §10, M5): collapsed by default, always in the DOM for screen readers
 * and for anyone who prefers numbers.
 */
export function SectionCard({
  title,
  description,
  actions,
  table,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  table?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-xs", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-bold tracking-tight">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      {table ? (
        <details className="group rounded-xl border bg-muted/60 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <TableIcon className="size-4" aria-hidden />
            <span className="group-open:hidden">Show as table</span>
            <span className="hidden group-open:inline">Hide table</span>
          </summary>
          <div className="overflow-x-auto border-t px-3 pb-3">{table}</div>
        </details>
      ) : null}
    </section>
  );
}

export function PageHeading({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="space-y-3">
      {eyebrow ? <p className="text-sm font-semibold tracking-wide text-highlight uppercase">{eyebrow}</p> : null}
      <h1 className="font-heading text-4xl leading-tight font-bold tracking-tight text-balance sm:text-5xl">{title}</h1>
      {children ? <div className="max-w-2xl text-base text-muted-foreground sm:text-lg">{children}</div> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-dashed bg-muted/50 p-6 text-center text-sm text-muted-foreground">
      <div className="max-w-sm">{children}</div>
    </div>
  );
}
