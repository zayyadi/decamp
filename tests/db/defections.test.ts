import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addSource,
  createEvent,
  createSeededDb,
  legislator,
  publish,
  setDemoMode,
} from "./fixtures";
import { ADMIN_ID, adminClaims, asRole, one, rows, userClaims } from "./harness";

let db: PGliteInterface;
beforeEach(async () => {
  db = await createSeededDb();
});
afterEach(() => db.close());

const history = (name: string) =>
  rows<{ party: string; start_date: string; end_date: string | null }>(
    db,
    `select p.code as party, pa.start_date::text, pa.end_date::text
     from party_affiliations pa
     join parties p on p.id = pa.party_id
     join legislators l on l.id = pa.legislator_id
     where l.full_name = $1
     order by pa.start_date, pa.id`,
    [name],
  );

const alerts = () =>
  rows<{ kind: string; level: string; title: string; body: string }>(
    db,
    "select kind, level, title, body from alerts order by id",
  );

describe("publish_defection", () => {
  it("moves the legislator, rewrites history and raises a confirmed alert", async () => {
    const id = await createEvent(db, {
      name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-09-14",
    });
    await addSource(db, id, "https://example.org/a");

    expect(await publish(db, id)).toEqual({ status: "published" });

    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("APC");
    expect(await history("Barnabas Okeyode")).toEqual([
      { party: "PDP", start_date: "2023-06-13", end_date: "2026-09-14" },
      { party: "APC", start_date: "2026-09-14", end_date: null },
    ]);
    expect(await alerts()).toEqual([
      {
        kind: "published",
        level: "confirmed",
        title: "Sen. Barnabas Okeyode (Ondo Demo District 1, Ondo) defects from PDP to APC",
        body: "Confirmed. 1 source.",
      },
    ]);
  });

  it("is idempotent", async () => {
    const id = await createEvent(db, {
      name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-09-14",
    });
    await publish(db, id);
    await publish(db, id);

    expect(await history("Barnabas Okeyode")).toHaveLength(2);
    expect(await alerts()).toHaveLength(1);
  });

  it("words a return to a former party", async () => {
    const id = await createEvent(db, {
      name: "Adaeze Nwankwo-Ibe", from: "APC", to: "APGA", date: "2026-08-01", isReturn: true,
    });
    await publish(db, id);
    expect((await alerts())[0].title).toBe(
      "Sen. Adaeze Nwankwo-Ibe (Anambra Demo District 1, Anambra) returns to APGA from APC",
    );
  });

  it("changes nothing when it fails (from_party mismatch)", async () => {
    const id = await createEvent(db, {
      name: "Barnabas Okeyode", from: "LP", to: "APC", date: "2026-09-14",
    });
    await expect(publish(db, id)).rejects.toThrow(/from_party does not match/);

    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("PDP");
    expect(await history("Barnabas Okeyode")).toHaveLength(1);
    expect(await alerts()).toEqual([]);
    const e = await one<{ status: string }>(db, "select status from defection_events where id = $1", [id]);
    expect(e.status).toBe("detected");
  });

  it.each([
    ["an unresolved legislator", { name: "Nobody In The Roster", from: "PDP", to: "APC" }, /unresolved/],
    ["an unknown destination", { name: "Barnabas Okeyode", from: "PDP", to: null }, /destination party is unknown/],
    ["a former legislator", { name: "Idris Ocheja-Fictional", from: "PDP", to: "SDP" }, /status is former/],
    ["a no-op move", { name: "Barnabas Okeyode", from: "PDP", to: "PDP" }, /already in the destination party/],
    ["a date before the current affiliation", { name: "Adaeze Nwankwo-Ibe", from: "APC", to: "PDP", date: "2024-01-01" }, /precedes the current affiliation/],
  ])("rejects %s", async (_label, opts, error) => {
    const id = await createEvent(db, opts);
    await expect(publish(db, id)).rejects.toThrow(error);
  });

  it("refuses events that were rejected", async () => {
    const id = await createEvent(db, {
      name: "Barnabas Okeyode", from: "PDP", to: "APC", status: "rejected",
    });
    await expect(publish(db, id)).rejects.toThrow(/status rejected/);
  });

  it("lets admins publish and records them as the reviewer", async () => {
    const id = await createEvent(db, {
      name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-09-14", status: "in_review",
    });
    await asRole(db, "authenticated", (tx) => tx.query("select public.publish_defection($1)", [id]), adminClaims);

    const e = await one<{ reviewed_by: string }>(db, "select reviewed_by from defection_events where id = $1", [id]);
    expect(e.reviewed_by).toBe(ADMIN_ID);
    expect((await alerts())[0].body).toBe("Approved by an editor after review. 0 sources.");
  });

  it("refuses anon and non-admin users", async () => {
    const id = await createEvent(db, { name: "Barnabas Okeyode", from: "PDP", to: "APC" });
    await expect(
      asRole(db, "anon", (tx) => tx.query("select public.publish_defection($1)", [id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("select public.publish_defection($1)", [id]), userClaims),
    ).rejects.toThrow(/not authorised/);
    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("PDP");
  });
});

describe("reverse_defection", () => {
  const reverse = (id: string, note: string) =>
    asRole(db, "service_role", (tx) =>
      tx.query("select public.reverse_defection($1, $2)", [id, note]),
    );

  it("restores the previous party and posts a correction", async () => {
    const id = await createEvent(db, {
      name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-09-14",
    });
    await publish(db, id);
    await reverse(id, "The reported defection letter was withdrawn before plenary.");

    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("PDP");
    expect(await history("Barnabas Okeyode")).toEqual([
      { party: "PDP", start_date: "2023-06-13", end_date: null },
    ]);
    const e = await one<{ status: string }>(db, "select status from defection_events where id = $1", [id]);
    expect(e.status).toBe("reversed");
    expect((await alerts()).map((a) => [a.kind, a.title])).toEqual([
      ["published", "Sen. Barnabas Okeyode (Ondo Demo District 1, Ondo) defects from PDP to APC"],
      ["correction", "Correction: Sen. Barnabas Okeyode defection record withdrawn"],
    ]);
  });

  it("only reverses the most recent defection", async () => {
    const first = await createEvent(db, {
      name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-01-10",
    });
    await publish(db, first);
    const second = await createEvent(db, {
      name: "Barnabas Okeyode", from: "APC", to: "ADC", date: "2026-05-01",
    });
    await publish(db, second);

    await expect(reverse(first, "wrong")).rejects.toThrow(/most recent/);
    await reverse(second, "Misreported.");
    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("APC");
  });

  it("requires a note and a published event", async () => {
    const id = await createEvent(db, { name: "Barnabas Okeyode", from: "PDP", to: "APC" });
    await expect(reverse(id, "not published")).rejects.toThrow(/only published events/);
    await publish(db, id);
    await expect(reverse(id, "  ")).rejects.toThrow(/note is required/);
  });
});

describe("party_strength", () => {
  type Strength = { code: string; seats: number };
  const strength = async (chamber: string | null, asOf: string) =>
    Object.fromEntries(
      (
        await rows<Strength>(
          db,
          "select code, seats::int as seats from public.party_strength($1, $2::date)",
          [chamber, asOf],
        )
      ).map((r) => [r.code, r.seats]),
    );

  it("counts seats as of a date, per chamber", async () => {
    const id = await createEvent(db, {
      name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-09-14",
    });
    await publish(db, id);

    const before = await strength("senate", "2026-09-13");
    const after = await strength("senate", "2026-09-14");
    expect(after.APC).toBe(before.APC + 1);
    expect(after.PDP).toBe(before.PDP - 1);
    expect(await strength("house", "2026-09-14")).toEqual(await strength("house", "2026-09-13"));

    const total = (s: Record<string, number>) => Object.values(s).reduce((a, b) => a + b, 0);
    expect(total(after)).toBe(20);
  });

  it("applies seeded party history at its effective date", async () => {
    expect((await strength("senate", "2025-03-03")).APGA).toBe(1);
    expect((await strength("senate", "2025-03-04")).APGA).toBeUndefined();
  });

  it("excludes members who left office", async () => {
    expect(await strength("senate", "2018-01-01")).toEqual({ PDP: 1 });
  });

  it("hides fictional seats from the public unless demo mode is on", async () => {
    const asAnon = () =>
      asRole(db, "anon", (tx) =>
        rows(tx, "select * from public.party_strength('senate', '2026-01-01')"),
      );
    expect(await asAnon()).toEqual([]);
    await setDemoMode(db, true);
    expect((await asAnon()).length).toBeGreaterThan(0);
  });
});
