import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type PGliteInterface, type Transaction } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export type ApiRole = "anon" | "authenticated" | "service_role";

export const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
export const adminClaims = {
  role: "authenticated",
  sub: ADMIN_ID,
  app_metadata: { role: "admin" },
};
export const userClaims = {
  role: "authenticated",
  sub: "00000000-0000-4000-8000-000000000002",
  app_metadata: {},
};

/** Runs `fn` as an API role, the way PostgREST does, inside a transaction. */
export async function asRole<T>(
  db: PGliteInterface,
  role: ApiRole,
  fn: (tx: Transaction) => Promise<T>,
  claims: object = { role },
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
    return fn(tx);
  });
}

export async function rows<T>(
  db: PGliteInterface | Transaction,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T>(
  db: PGliteInterface | Transaction,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await rows<T>(db, sql, params);
  if (result.length !== 1) {
    throw new Error(`expected 1 row, got ${result.length}: ${sql}`);
  }
  return result[0];
}
