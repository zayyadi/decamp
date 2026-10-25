import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/admin/login-form";
import { getSession } from "@/lib/auth";
import { safeNext } from "@/lib/review";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="space-y-2">
        <p className="text-sm font-semibold tracking-wide text-highlight uppercase">Admin</p>
        <h1 className="font-heading text-4xl font-bold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">For editors who review detected defections. Accounts are created by the project owner.</p>
      </div>
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl bg-muted" />}>
        <Login searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Login({ searchParams }: { searchParams: PageProps<"/admin/login">["searchParams"] }) {
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  if ((await getSession()).kind === "admin") redirect(next);
  return <LoginForm next={next} />;
}
