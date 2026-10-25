import { ArrowLeftRightIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { MainNav, StaticMainNav } from "./main-nav";
import { ThemeToggle } from "./theme";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="DecampWatch NG, overview" className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ArrowLeftRightIcon className="size-4" aria-hidden />
          </span>
          {/* On phones the mark alone leaves room for the nav. */}
          <span aria-hidden className="hidden font-heading text-xl leading-none font-bold tracking-tight sm:inline">
            DecampWatch<span className="text-highlight"> NG</span>
          </span>
        </Link>
        {/* The active tab depends on the URL, which dynamic routes only know at request time. */}
        <Suspense fallback={<StaticMainNav />}>
          <MainNav />
        </Suspense>
        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
