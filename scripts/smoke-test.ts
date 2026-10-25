import { parseArgs } from "node:util";
import { getSiteEnv } from "@/lib/env";
import { loadLocalEnv } from "./lib/load-env";

async function main() {
  const { values } = parseArgs({ options: { url: { type: "string" } } });
  loadLocalEnv();
  const input = values.url ?? getSiteEnv().NEXT_PUBLIC_SITE_URL;
  if (!input) throw new Error("Pass --url https://your-deployment or set NEXT_PUBLIC_SITE_URL.");
  const base = new URL(input);
  if (!["https:", "http:"].includes(base.protocol)) throw new Error("Use an HTTP(S) deployment URL.");
  const checks = [
    { path: "/", title: "Who is" }, { path: "/legislators", title: "Legislators" },
    { path: "/about", title: "Methodology and corrections" }, { path: "/admin/login", title: "Sign in" },
  ];
  let failed = false;
  for (const check of checks) {
    const response = await fetch(new URL(check.path, base.origin), { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const html = await response.text();
    const passed = response.status === 200 && html.includes(check.title) &&
      !/The service may be temporarily unavailable|DecampWatch NG is temporarily unavailable/.test(html);
    console.log(`${passed ? "PASS" : "FAIL"} ${check.path} (HTTP ${response.status})`);
    failed ||= !passed;
  }
  const health = await fetch(new URL("/api/health", base.origin), { signal: AbortSignal.timeout(10000) });
  const healthy = health.status === 200 && (await health.json()).status === "ok";
  console.log(`${healthy ? "PASS" : "FAIL"} /api/health (HTTP ${health.status})`);
  failed ||= !healthy;
  for (const path of ["/admin/review", "/admin/published", "/admin/runs"]) {
    const response = await fetch(new URL(path, base.origin), { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const destination = response.headers.get("location");
    const passed = [302, 303, 307, 308].includes(response.status) && destination !== null &&
      new URL(destination, base.origin).origin === base.origin && new URL(destination, base.origin).pathname === "/admin/login";
    console.log(`${passed ? "PASS" : "FAIL"} ${path} redirects signed-out visitors`);
    failed ||= !passed;
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Smoke test failed."); process.exitCode = 1; });
