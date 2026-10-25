import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGliteInterface } from "@electric-sql/pglite";
import { parseRosterCsv, type RosterRow } from "@/scripts/lib/roster-csv";
import { asRole, createTestDb, one } from "./harness";

let seededTemplate: Promise<PGliteInterface> | undefined;

/**
 * A fresh database with migrations applied and the fictional roster seeded.
 * Built once per test file, then cloned, so each test starts clean without
 * paying for migrations again. Each clone is its own WASM heap (hundreds of
 * MB), so callers must `close()` it, typically in `afterEach`.
 */
export async function createSeededDb(): Promise<PGliteInterface> {
  seededTemplate ??= createTestDb().then(async (db) => {
    await seedRoster(db, fictionalRows());
    return db;
  });
  return (await seededTemplate).clone();
}

const fictionalCsv = join(
  import.meta.dirname, "..", "..", "supabase", "seed", "legislators.fictional.csv",
);

export function fictionalRows(): RosterRow[] {
  const { rows, errors } = parseRosterCsv(readFileSync(fictionalCsv, "utf8"), {
    fictional: true,
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return rows;
}

export interface SeedResult {
  inserted: number;
  updated: number;
  warnings: string[];
}

export async function seedRoster(
  db: PGliteInterface,
  rows: unknown[],
  fictional = true,
): Promise<SeedResult> {
  return asRole(db, "service_role", async (tx) => {
    const r = await one<{ result: SeedResult }>(
      tx,
      "select public.seed_roster($1::jsonb, $2) as result",
      [JSON.stringify(rows), fictional],
    );
    return r.result;
  });
}

export async function setDemoMode(db: PGliteInterface, on: boolean): Promise<void> {
  await asRole(db, "service_role", (tx) =>
    tx.query("select public.set_demo_mode($1)", [on]),
  );
}

export async function legislator(
  db: PGliteInterface,
  fullName: string,
): Promise<{ id: string; party: string; status: string }> {
  return one(
    db,
    `select l.id, p.code as party, l.status
     from legislators l join parties p on p.id = l.current_party_id
     where l.full_name = $1`,
    [fullName],
  );
}

let eventCounter = 0;

/** Inserts a defection event directly (as the table owner, like the agent's service role would). */
export async function createEvent(
  db: PGliteInterface,
  opts: {
    name: string;
    from: string | null;
    to: string | null;
    date?: string | null;
    status?: string;
    isReturn?: boolean;
  },
): Promise<string> {
  eventCounter += 1;
  const r = await one<{ id: string }>(
    db,
    `insert into defection_events (
       legislator_id, raw_name, from_party_id, to_party_id, event_type,
       is_return, event_date, chamber, state, confidence, status,
       evidence_quote, dedupe_key
     )
     select l.id, coalesce(l.full_name, $1), fp.id, tp.id, 'CONFIRMED_DEFECTION',
            $5, $4::date, l.chamber, l.state, 0.95, $6,
            'I have today joined the party.', $7
     from (select 1) one
     left join legislators l on l.full_name = $1
     left join parties fp on fp.code = $2
     left join parties tp on tp.code = $3
     returning id`,
    [
      opts.name,
      opts.from,
      opts.to,
      opts.date ?? null,
      opts.isReturn ?? false,
      opts.status ?? "detected",
      `test:${eventCounter}`,
    ],
  );
  return r.id;
}

export async function addSource(
  db: PGliteInterface,
  eventId: string,
  url: string,
): Promise<number> {
  const a = await one<{ id: number }>(
    db,
    `insert into articles (url, outlet, title, published_at, content)
     values ($1, 'demo-outlet', 'Demo headline', now(), 'Full article body (internal).')
     returning id`,
    [url],
  );
  await db.query(
    "insert into event_sources (event_id, article_id, evidence_quote) values ($1, $2, 'quote')",
    [eventId, a.id],
  );
  return a.id;
}

export async function publish(db: PGliteInterface, eventId: string) {
  return asRole(db, "service_role", (tx) =>
    one<{ status: string }>(tx, "select (public.publish_defection($1)).status", [eventId]),
  );
}
