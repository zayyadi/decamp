"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/legislators", label: "Legislators" },
] as const;

const isActive = (href: string, pathname: string | null) =>
  pathname !== null && (href === "/" ? pathname === "/" || pathname.startsWith("/events") : pathname.startsWith(href));

function Nav({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-1 rounded-full border bg-muted p-1 text-sm">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href, pathname) ? "page" : undefined}
          className={cn(
            "rounded-full px-2.5 py-1.5 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-3",
            "aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function MainNav() {
  return <Nav pathname={usePathname()} />;
}

/** Prerendered placeholder: the same links, none marked active. */
export function StaticMainNav() {
  return <Nav pathname={null} />;
}
