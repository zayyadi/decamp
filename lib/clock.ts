import "server-only";
import { connection } from "next/server";
import { todayInLagos } from "./format";

/**
 * The time for this request. `connection()` keeps the caller out of the
 * prerendered shell, so "today" and relative times are never frozen at build.
 */
export async function requestClock(): Promise<{ now: number; today: string }> {
  await connection();
  const now = Date.now();
  return { now, today: todayInLagos(new Date(now)) };
}
