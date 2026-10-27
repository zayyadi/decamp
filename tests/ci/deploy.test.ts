import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The VPS files can't run here (they need root and a server), so check what
// can be: they parse, and they agree with each other and with .env.example.
const root = join(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;

const service = read("deploy", "decamp.service");
const nginx = read("deploy", "nginx.conf");
const bootstrap = read("deploy", "bootstrap.sh");
const webEnv = read("deploy", "web.env.example");
const vpsDoc = read("docs", "VPS.md");

describe("VPS deployment files", () => {
  it.skipIf(!hasBash).each(["bootstrap.sh", "release.sh"])("%s parses", (name) => {
    const r = spawnSync("bash", ["-n", join(root, "deploy", name)], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("uses one default port, bound to loopback only", () => {
    const port = /--hostname 127\.0\.0\.1 --port (\d+)/.exec(service)?.[1];
    expect(port).toBe("3100");
    expect(bootstrap).toContain(`port="${port}"`);
    expect(vpsDoc).toContain(`127.0.0.1:${port}`);
  });

  it("templates its own Nginx site without taking over the server", () => {
    expect(nginx).toContain("server_name __DOMAIN__;");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:__PORT__;");
    expect(nginx).toContain("proxy_buffering off;");
    expect(nginx).not.toMatch(/default_server/);
  });

  it("lists exactly the web app's settings, and no agent credentials", () => {
    const keys = (text: string) => [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]).sort();
    const webKeys = keys(read(".env.example")).filter((k) => k.startsWith("NEXT_PUBLIC_") || k === "SUPABASE_SECRET_KEY");
    expect(keys(webEnv)).toEqual(webKeys);
    expect(keys(webEnv)).not.toContain("ANTHROPIC_API_KEY");
    expect(keys(webEnv)).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
});
