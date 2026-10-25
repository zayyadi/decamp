import { connection } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

export async function GET() {
  await connection();
  try {
    const env = getPublicEnv();
    const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
    });
    const { data, error } = await db.from("app_settings").select("id, historical_coverage").single();
    if (error || !data) throw new Error("Database unavailable");
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
