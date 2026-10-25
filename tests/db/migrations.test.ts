import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createTestDb, one, rows } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

describe("migrations", () => {
  it("load all 36 states plus the FCT, with 109 senate seats", async () => {
    const r = await one<{ n: number; seats: number }>(
      db,
      "select count(*)::int as n, sum(senate_seats)::int as seats from ng_states",
    );
    expect(r).toEqual({ n: 37, seats: 109 });
  });

  it("load the party register", async () => {
    const codes = await rows<{ code: string }>(db, "select code from parties order by code");
    expect(codes.map((c) => c.code)).toEqual(
      expect.arrayContaining(["APC", "PDP", "LP", "NNPP", "APGA", "SDP", "ADC"]),
    );
  });

  it("enable RLS on every public table", async () => {
    const unprotected = await rows<{ relname: string }>(
      db,
      `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(unprotected).toEqual([]);
  });

  it("start with demo mode off", async () => {
    const r = await asRole(db, "anon", (tx) =>
      one<{ on: boolean }>(tx, "select public.demo_mode() as on"),
    );
    expect(r.on).toBe(false);
  });
});
