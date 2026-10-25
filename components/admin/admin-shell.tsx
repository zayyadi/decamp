import { LogOutIcon, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/admin/actions";
import { buttonVariants } from "@/components/ui/button";
import { requireSignedIn } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <LogOutIcon aria-hidden /> Sign out
      </button>
    </form>
  );
}

/**
 * Wraps every admin page. Signed-out visitors go to the login page; a
 * signed-in account without the admin role sees why, not a broken page.
 */
export async function AdminGate({ path, children }: { path: string; children: ReactNode }) {
  const session = await requireSignedIn(path);
  if (session.kind !== "admin") {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-start gap-4 rounded-2xl border bg-card p-6">
        <ShieldAlertIcon className="size-8 text-highlight" aria-hidden />
        <h1 className="font-heading text-2xl font-bold">This account isn&apos;t an admin</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as {session.email ?? "an unknown user"}, but only admins can review events. Ask a project
          owner to run <code className="rounded bg-muted px-1">npm run admin -- --grant {session.email ?? "<email>"}</code>, then
          sign in again.
        </p>
        <SignOutButton />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted p-2">
        <AdminNav />
        <div className="flex items-center gap-2 pr-1 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{session.email}</span>
          <SignOutButton />
        </div>
      </div>
      {children}
    </div>
  );
}

export function AdminPage({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed bg-muted/50 p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function AdminLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-highlight hover:underline">
      {children}
    </Link>
  );
}
