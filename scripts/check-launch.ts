import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { getAgentEnv, getPublicEnv, getServiceEnv, getSiteEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import { loadLocalEnv } from "./lib/load-env";
import { assessDatabase, assessEvidence, readinessSchema, type LaunchCheck } from "./lib/launch-check";

async function main() {
  const { values } = parseArgs({ options: { evidence: { type: "string", default: "docs/launch-evidence.json" }, output: { type: "string" } } });
  loadLocalEnv();
  const checks: LaunchCheck[] = assessEvidence(JSON.parse(readFileSync(values.evidence, "utf8")));
  const site = getSiteEnv();
  checks.push({ id: "public_site", passed: Boolean(site.NEXT_PUBLIC_SITE_URL?.startsWith("https://")), detail: "Set NEXT_PUBLIC_SITE_URL to the production HTTPS origin." });
  checks.push({ id: "corrections_contact", passed: Boolean(site.NEXT_PUBLIC_CORRECTIONS_URL), detail: "Set NEXT_PUBLIC_CORRECTIONS_URL to a working public contact page or mailto: address." });
  try {
    getAgentEnv();
    checks.push({ id: "agent_env", passed: true, detail: "Agent configuration validates; credentials have not been exercised." });
  } catch {
    checks.push({ id: "agent_env", passed: false, detail: "Agent environment is incomplete or invalid; check .env.example. No values are printed." });
  }
  try {
    const publicEnv = getPublicEnv();
    const serviceEnv = getServiceEnv();
    checks.push({ id: "database_target", passed: new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).origin === new URL(serviceEnv.SUPABASE_URL).origin, detail: "Public and service clients must target the same production database." });
    const { data, error } = await createServiceClient().rpc("launch_readiness");
    if (error) {
      checks.push({ id: "database_audit", passed: false, detail: "Database audit unavailable. Apply pending migrations, including 20261025000007_launch_readiness.sql, and verify service credentials." });
    } else checks.push(...assessDatabase(readinessSchema.parse(data)));

    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const [drafts, fictional, bodies] = await Promise.all([
      anon.from("defection_events").select("id, status").neq("status", "published").limit(1),
      anon.from("legislators").select("id").eq("is_fictional", true).limit(1),
      anon.from("articles").select("content").limit(1),
    ]);
    checks.push({ id: "anon_drafts", passed: !drafts.error && drafts.data?.length === 0, detail: "Anonymous queries must return no unpublished events." });
    checks.push({ id: "anon_fictional", passed: !fictional.error && fictional.data?.length === 0, detail: "Anonymous queries must return no fictional members." });
    checks.push({ id: "anon_article_bodies", passed: bodies.error?.code === "42501", detail: "Anonymous article-body queries must be denied at the permission boundary." });
  } catch {
    checks.push({ id: "database_connection", passed: false, detail: "Database audit could not complete. Check configuration, migrations, and network access. No credential values are printed." });
  }
  const report = { checked_at: new Date().toISOString(), ready: checks.every((c) => c.passed), checks };
  for (const check of checks) console.log(`${check.passed ? "PASS" : "BLOCKED"} ${check.id}: ${check.detail}`);
  if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(report.ready ? "Recorded launch checks pass. Verify the deployed smoke test before announcing launch." : "Public launch is blocked by the checks above.");
  process.exitCode = report.ready ? 0 : 1;
}

main().catch(() => { console.error("Launch check failed. Check configuration and evidence file format; no secrets were printed."); process.exitCode = 1; });
