import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the real deploy/release.sh in a temp folder. sudo, id, systemctl, npm
// and curl are stand-ins; git and the release logic are real.
const script = join(import.meta.dirname, "..", "..", "deploy", "release.sh");
const hasTools =
  process.platform !== "win32" && ["bash", "git"].every((c) => spawnSync(c, ["--version"]).status === 0);

let dir: string;
let repo: string;

function stub(name: string, body: string) {
  writeFileSync(join(dir, "bin", name), `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(join(dir, "bin", name), 0o755);
}

function git(...args: string[]) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "release-"));
  for (const d of ["bin", "home/releases", "etc"]) mkdirSync(join(dir, d), { recursive: true });
  repo = join(dir, "src");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "one");

  stub("id", 'echo 0');
  // sudo -u decamp -H env PATH=... cmd... : run cmd as ourselves, keeping the stub PATH.
  stub("sudo", 'while [ $# -gt 0 ] && [[ "$1" != PATH=* ]]; do shift; done; shift; exec "$@"');
  stub("systemctl", 'echo "systemctl $*" >> "$LOG"');
  stub("npm", 'if [ "$1" = run ] && [ "${FAKE_BUILD:-ok}" = fail ]; then exit 1; fi; exit 0');
  stub("curl", '[ "${FAKE_HEALTH:-ok}" = ok ]');
  writeFileSync(join(dir, "etc", "deploy.conf"), `DOMAIN=example.test\nPORT=3100\nREPO=${repo}\n`);
  writeFileSync(join(dir, "etc", "web.env"), "NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function release(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      HOME: dir,
      DECAMP_HOME: join(dir, "home"),
      DECAMP_ETC: join(dir, "etc"),
      DECAMP_HEALTH_TRIES: "1",
      LOG: join(dir, "log"),
      ...env,
    },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const releases = () => readdirSync(join(dir, "home", "releases")).sort();
const live = () => {
  const link = join(dir, "home", "current");
  return existsSync(link) ? readlinkSync(link) : null;
};

describe.skipIf(!hasTools)("deploy/release.sh", () => {
  it("builds a branch, switches to it and restarts", () => {
    const r = release(["main"]);
    expect(r.status).toBe(0);
    expect(releases()).toHaveLength(1);
    expect(live()).toBe(join(dir, "home", "releases", releases()[0]));
    expect(r.out).toContain(`live: ${git("rev-parse", "--short=7", "HEAD")} at https://example.test`);
  });

  it("on a failed first build, says nothing is live and leaves no folder behind", () => {
    const r = release(["main"], { FAKE_BUILD: "fail" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("build failed; no release is live yet");
    expect(releases()).toEqual([]);
    expect(live()).toBeNull();
  });

  it("on a failed later build, keeps the live release and names it", () => {
    release(["main"]);
    const before = live();
    const r = release(["main"], { FAKE_BUILD: "fail" });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`build failed; the live release is unchanged (${before})`);
    expect(live()).toBe(before);
    expect(releases()).toHaveLength(1);
  });

  it("switches back when the new release fails its health check", () => {
    release(["main"]);
    const before = live();
    // The stand-in curl fails for the whole run, so the switch-back can't verify either.
    const r = release(["main"], { FAKE_HEALTH: "fail" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("/api/health failed after switching");
    expect(live()).toBe(before);
  });

  it("rolls back to the previous release, and refuses when there is none", () => {
    expect(release(["--rollback"]).out).toContain("no earlier release to roll back to");
    release(["main"]);
    const first = live();
    release(["main"]);
    expect(live()).not.toBe(first);
    const r = release(["--rollback"]);
    expect(r.status).toBe(0);
    expect(live()).toBe(first);
  });

  it("rolls back step by step, never forward, and stops at the oldest", () => {
    for (let i = 0; i < 3; i++) release(["main"]);
    const [oldest, middle, newest] = releases();
    expect(live()?.endsWith(newest)).toBe(true);
    release(["--rollback"]);
    expect(live()?.endsWith(middle)).toBe(true);
    release(["--rollback"]);
    expect(live()?.endsWith(oldest)).toBe(true);
    expect(release(["--rollback"]).out).toContain("no earlier release to roll back to");
  });

  it("keeps only the three newest releases", () => {
    for (let i = 0; i < 4; i++) release(["main"]);
    expect(releases()).toHaveLength(3);
    expect(releases()).toContain(live()!.split("/").pop());
  });

  it("refuses an unknown ref and an unfilled settings file", () => {
    expect(release(["no-such-branch"]).out).toContain("unknown commit or branch: no-such-branch");
    writeFileSync(join(dir, "etc", "web.env"), "NEXT_PUBLIC_SUPABASE_URL=\n");
    expect(release(["main"]).out).toContain("fill in");
  });
});
