import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { PartyNames } from "@/agent/filter";

export interface ArticleRow {
  url: string;
  outlet: string;
  title: string;
  published_at: string | null;
  content: string | null;
  content_hash: string | null;
  prefilter_hit: boolean;
  run_id: number | null;
}

export interface RunSummary {
  feeds_ok?: number;
  feeds_failed?: number;
  articles_new?: number;
  articles_prefiltered?: number;
  llm_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  events_created?: number;
  events_published?: number;
  errors: { where: string; message: string }[];
}

export interface IngestStore {
  parties(): Promise<PartyNames[]>;
  /** The subset of `urls` already stored. */
  knownUrls(urls: string[]): Promise<Set<string>>;
  /** Inserts rows whose URL is new and returns the rows actually inserted. */
  insertArticles(rows: ArticleRow[]): Promise<{ url: string; prefilter_hit: boolean }[]>;
  startRun(): Promise<number | null>;
  finishRun(id: number | null, summary: RunSummary): Promise<void>;
}

const partyRows = z.array(z.object({ code: z.string(), name: z.string(), aliases: z.array(z.string()) }));
const urlRows = z.array(z.object({ url: z.string() }));
const insertedRows = z.array(z.object({ url: z.string(), prefilter_hit: z.boolean() }));
const runRow = z.object({ id: z.number() });

// URLs go in the query string of a GET, so look them up in batches.
const LOOKUP_BATCH = 50;

function check<T>(schema: z.ZodType<T>, result: { data: unknown; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return schema.parse(result.data);
}

export function supabaseIngestStore(db: SupabaseClient): IngestStore {
  return {
    async parties() {
      return check(partyRows, await db.from("parties").select("code, name, aliases"), "load parties");
    },

    async knownUrls(urls) {
      const known = new Set<string>();
      for (let i = 0; i < urls.length; i += LOOKUP_BATCH) {
        const batch = urls.slice(i, i + LOOKUP_BATCH);
        const rows = check(urlRows, await db.from("articles").select("url").in("url", batch), "look up URLs");
        for (const row of rows) known.add(row.url);
      }
      return known;
    },

    async insertArticles(rows) {
      if (rows.length === 0) return [];
      // The unique constraint on url is what makes re-runs idempotent.
      const result = await db
        .from("articles")
        .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
        .select("url, prefilter_hit");
      return check(insertedRows, result, "insert articles");
    },

    async startRun() {
      const result = await db.from("agent_runs").insert({}).select("id").single();
      return check(runRow, result, "start run").id;
    },

    async finishRun(id, summary) {
      if (id === null) return;
      const { error } = await db
        .from("agent_runs")
        .update({ ...summary, finished_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`finish run: ${error.message}`);
    },
  };
}

/** Reads go to the database; writes are reported but not made (`--dry-run`). */
export function dryRunStore(real: IngestStore): IngestStore {
  return {
    parties: () => real.parties(),
    knownUrls: (urls) => real.knownUrls(urls),
    insertArticles: async (rows) => rows.map(({ url, prefilter_hit }) => ({ url, prefilter_hit })),
    startRun: async () => null,
    finishRun: async () => {},
  };
}
