"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type Ref } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/legislators", label: "Legislators" },
  { href: "/assemblies", label: "Assemblies" },
  { href: "/about", label: "About" },
] as const;

const isActive = (href: string, pathname: string | null) =>
  pathname !== null && (href === "/" ? pathname === "/" || pathname.startsWith("/events") : pathname.startsWith(href));

function Nav({ pathname, ref }: { pathname: string | null; ref?: Ref<HTMLElement> }) {
  return (
    // On narrow phones the links scroll sideways inside the pill instead of overflowing the header.
    <nav
      ref={ref}
      aria-label="Main"
      className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border bg-muted p-1 text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href, pathname) ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1.5 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-3",
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
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  // Bring the current page's link into view when the row is scrolled on phones.
  useEffect(() => {
    const nav = ref.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !link) return;
    if (link.offsetLeft + link.offsetWidth > nav.scrollLeft + nav.clientWidth || link.offsetLeft < nav.scrollLeft) {
      nav.scrollLeft = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
    }
  }, [pathname]);
  return <Nav pathname={pathname} ref={ref} />;
}

/** Prerendered placeholder: the same links, none marked active. */
export function StaticMainNav() {
  return <Nav pathname={null} />;
}
