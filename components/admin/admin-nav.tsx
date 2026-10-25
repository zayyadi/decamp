"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/review", label: "Review queue" },
  { href: "/admin/published", label: "Published" },
  { href: "/admin/runs", label: "Agent runs" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="flex flex-wrap items-center gap-1 text-sm">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname.startsWith(href) ? "page" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
            "aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
