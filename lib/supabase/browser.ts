import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

/**
 * Anon client for Realtime. It never reads or refreshes the admin's session:
 * a browser-side refresh racing the server's would trip Supabase's
 * refresh-token reuse detection and sign the admin out. One per tab.
 */
export function getBrowserClient(): SupabaseClient {
  if (!client) {
    const env = getPublicEnv();
    client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
