import type { PGliteInterface } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSeededDb } from "./fixtures";
import { rows } from "./harness";

let db: PGliteInterface;
beforeAll(async () => {
  db = await createSeededDb();
});
afterAll(() => db.close());

describe("realtime publication", () => {
  it("streams alerts and defection events, and nothing internal", async () => {
    const tables = await rows<{ tablename: string }>(
      db,
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename",
    );
    // articles (with full text), agent_runs and review_feedback must never be streamed.
    expect(tables.map((t) => t.tablename)).toEqual(["alerts", "defection_events"]);
  });
});
