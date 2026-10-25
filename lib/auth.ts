import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Data access layer for admin pages and actions. getClaims() verifies the JWT,
// so the role can't be forged in a cookie. The SQL functions check the same
// claim again (is_admin), which is the real gate.

export type Session =
  | { kind: "admin"; userId: string; email: string | null }
  | { kind: "user"; email: string | null }
  | { kind: "anonymous" };

export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { kind: "anonymous" };
  const email = typeof claims.email === "string" ? claims.email : null;
  return claims.app_metadata?.role === "admin" ? { kind: "admin", userId: claims.sub, email } : { kind: "user", email };
});

/** For admin pages: sends signed-out visitors to the login page. */
export async function requireSignedIn(path: string): Promise<Exclude<Session, { kind: "anonymous" }>> {
  const session = await getSession();
  if (session.kind === "anonymous") redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  return session;
}

/** For server actions: true only for an admin. Callers return an error instead of redirecting mid-form. */
export async function isAdmin(): Promise<boolean> {
  return (await getSession()).kind === "admin";
}
