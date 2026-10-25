"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="font-heading text-3xl font-bold">This page couldn&apos;t load</h1>
      <p className="text-muted-foreground">The service may be temporarily unavailable. Try again in a moment.</p>
      <Button onClick={() => retry()}>Try again</Button>
      <Link href="/about" className="text-sm text-highlight underline">Methodology and corrections</Link>
    </main>
  );
}
