// VS Code terminals on Windows can start in `c:\...`. Vitest then loads its own
// modules under two spellings of the same path and every suite fails with
// "Cannot read properties of undefined (reading 'config')". Start it from the
// canonical upper-case drive letter instead.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cwd =
  process.platform === "win32"
    ? process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase())
    : process.cwd();

const { status, error } = spawnSync(
  process.execPath,
  [join(cwd, "node_modules", "vitest", "vitest.mjs"), ...process.argv.slice(2)],
  { cwd, stdio: "inherit" },
);

if (error) throw error;
process.exit(status ?? 1);
