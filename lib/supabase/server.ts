import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getPublicEnv } from "@/lib/env";

// Public reads: the publishable key with no session, so RLS applies exactly as
// for a visitor. It ignores auth cookies on purpose: refreshing a session
// during a page render can't save the new token, and Supabase's refresh-token
// rotation then signs the admin out. Only admin code uses createClient().
export async function createAnonClient() {
  await connection();
  const env = getPublicEnv();
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// The signed-in admin's session (admin pages, actions, sign-in). proxy.ts
// refreshes the token first on /admin routes, so this never has to.
export async function createClient() {
  // Request-time only: with a session, the auth client checks token expiry
  // against the clock, which prefetch prerenders (which can see cookies) refuse.
  await connection();
  const store = await cookies();
  const env = getPublicEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server components can't set cookies; the proxy refreshes sessions instead (M7).
        }
      },
    },
  });
}
