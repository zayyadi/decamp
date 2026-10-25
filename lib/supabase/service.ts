import { createClient } from "@supabase/supabase-js";
import { getServiceEnv } from "@/lib/env";

// Service role bypasses RLS. Import only from agent/, scripts/ or server-only
// admin actions (CLAUDE.md). Not marked "server-only" because plain Node
// scripts import it too, and that package throws outside Next.js.
export function createServiceClient() {
  const env = getServiceEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
