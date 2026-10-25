import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";

// Anon (publishable) client for server components, so RLS applies exactly as
// for a visitor. Cookies carry the admin session from Milestone 7 on.
export async function createClient() {
  // Cookies first: it marks the render as request-time, so prerendering never reaches the env check.
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
