"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toQuery } from "@/lib/filters";

/** Pushes a new set of URL filters; the server re-renders the page from them. */
export function useFilterNav<T extends object>(current: T) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const go = (patch: Partial<Record<keyof T, string | undefined>>) =>
    startTransition(() => router.push(`${pathname}${toQuery(current, patch)}`, { scroll: false }));
  return { go, pending };
}
