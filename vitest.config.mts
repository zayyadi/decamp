import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Each tests/db file holds an in-memory Postgres (PGlite); one worker per
    // core runs out of memory on an 8 GB machine.
    maxWorkers: 4,
    // The first hook in each tests/db file applies every migration and seeds
    // the roster, which takes longer than the 10 s default on slower machines.
    hookTimeout: 60_000,
  },
});
