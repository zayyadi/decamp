import "server-only";
import { z } from "zod";

// Rows from PostgREST are validated at the boundary, as the agent does, so a
// schema drift fails loudly here instead of rendering wrong numbers.

export function parseRows<T>(schema: z.ZodType<T>, result: { data: unknown; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return schema.parse(result.data);
}

// numeric and bigint come back as numbers or strings depending on the column.
export const num = z.union([z.number(), z.string()]).transform(Number);
export const chamber = z.enum(["senate", "house", "state_assembly"]);
