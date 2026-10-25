import { beforeEach, describe, expect, it, vi } from "vitest";

const { single, getPublicEnv } = vi.hoisted(() => ({ single: vi.fn(), getPublicEnv: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/env", () => ({ getPublicEnv }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => ({ select: () => ({ single }) }) }) }));
import { GET } from "@/app/api/health/route";

beforeEach(() => {
  vi.clearAllMocks();
  getPublicEnv.mockReturnValue({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test" });
});
describe("public health endpoint", () => {
  it("checks database access and prevents caching a stale healthy response", async () => {
    single.mockResolvedValue({ data: { id: true, historical_coverage: null }, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });
  it("returns a generic 503 without leaking database errors", async () => {
    single.mockResolvedValue({ data: null, error: { message: "Private database details" } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it("also handles missing environment configuration without exposing it", async () => {
    getPublicEnv.mockImplementation(() => { throw new Error("Private configuration details"); });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
