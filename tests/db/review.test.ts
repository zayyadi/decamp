import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSource, createEvent, createSeededDb, legislator, publish } from "./fixtures";
import { ADMIN_ID, adminClaims, asRole, one, rows, userClaims } from "./harness";

let db: PGliteInterface;
beforeEach(async () => {
  db = await createSeededDb();
});
afterEach(() => db.close());

const asAdmin = <T>(sql: string, params: unknown[] = []) =>
  asRole(db, "authenticated", (tx) => rows<T>(tx, sql, params), adminClaims);

const event = (id: string) =>
  one<{ status: string; legislator: string | null; from_party: string | null; to_party: string | null; event_date: string | null; review_note: string | null; reviewed_by: string | null }>(
    db,
    `select e.status, l.full_name as legislator, fp.code as from_party, tp.code as to_party,
            e.event_date::text, e.review_note, e.reviewed_by::text
     from defection_events e
     left join legislators l on l.id = e.legislator_id
     left join parties fp on fp.id = e.from_party_id
     left join parties tp on tp.id = e.to_party_id
     where e.id = $1`,
    [id],
  );

const feedback = (id: string) =>
  rows<{ action: string; reason_code: string | null; before: Record<string, unknown>; after: Record<string, unknown>; reviewer: string | null }>(
    db,
    "select action, reason_code, before, after, reviewer::text from review_feedback where event_id = $1 order by id",
    [id],
  );

const review = (name = "Barnabas Okeyode", from: string | null = "PDP", to: string | null = "APC") =>
  createEvent(db, { name, from, to, date: "2026-09-14", status: "in_review" });

describe("review_approve", () => {
  it("publishes, records the reviewer and writes feedback", async () => {
    const id = await review();
    await asAdmin("select public.review_approve($1)", [id]);
    expect(await event(id)).toMatchObject({ status: "published", reviewed_by: ADMIN_ID });
    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("APC");
    const fb = await feedback(id);
    expect(fb.map((f) => f.action)).toEqual(["approve"]);
    expect(fb[0]).toMatchObject({ reviewer: ADMIN_ID, before: { status: "in_review" }, after: { status: "published" } });
  });

  it("applies edits in the same transaction and records them", async () => {
    // The agent matched the wrong member and party; the reviewer corrects both.
    const id = await review("Halima Dogo-Fictional", "PDP", "SDP");
    const okeyode = await legislator(db, "Barnabas Okeyode");
    await asAdmin("select public.review_approve($1, $2, 'Checked the plenary record')", [
      id,
      JSON.stringify({ legislator_id: okeyode.id, from_party: "PDP", to_party: "APC", event_date: "2026-09-15" }),
    ]);
    expect(await event(id)).toMatchObject({
      status: "published",
      legislator: "Barnabas Okeyode",
      to_party: "APC",
      event_date: "2026-09-15",
      review_note: "Checked the plenary record",
    });
    const fb = await feedback(id);
    expect(fb.map((f) => f.action)).toEqual(["edit", "approve"]);
    expect(fb[0].before).toMatchObject({ to_party: "SDP" });
    expect(fb[0].after).toMatchObject({ to_party: "APC", legislator_id: okeyode.id });
  });

  it("rolls everything back when publish_defection refuses", async () => {
    // Halima is LP, so a move "from PDP" contradicts the roster.
    const id = await review("Halima Dogo-Fictional", "PDP", "APC");
    await expect(asAdmin("select public.review_approve($1, $2)", [id, JSON.stringify({ event_date: "2026-09-20" })])).rejects.toThrow(
      /from_party does not match/,
    );
    expect(await event(id)).toMatchObject({ status: "in_review", event_date: "2026-09-14" });
    expect(await feedback(id)).toEqual([]);
  });

  it("refuses unknown edit fields and parties", async () => {
    const id = await review();
    await expect(asAdmin("select public.review_approve($1, $2)", [id, JSON.stringify({ confidence: 1 })])).rejects.toThrow(/unknown edit fields: confidence/);
    await expect(asAdmin("select public.review_approve($1, $2)", [id, JSON.stringify({ to_party: "XYZ" })])).rejects.toThrow(/unknown destination party XYZ/);
  });

  it("cannot review an event twice", async () => {
    const id = await review();
    await asAdmin("select public.review_approve($1)", [id]);
    await expect(asAdmin("select public.review_reject($1, 'rumour')", [id])).rejects.toThrow(/already reviewed \(status is published\)/);
  });
});

describe("review_edit", () => {
  it("saves corrections without publishing", async () => {
    const id = await review("Barnabas Okeyode", "PDP", "SDP");
    await asAdmin("select public.review_edit($1, $2, 'Party name was misread')", [id, JSON.stringify({ to_party: "APC" })]);
    expect(await event(id)).toMatchObject({ status: "in_review", to_party: "APC", review_note: "Party name was misread" });
    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("PDP");
    expect((await feedback(id)).map((f) => f.action)).toEqual(["edit"]);
  });

  it("refuses an edit that changes nothing", async () => {
    const id = await review();
    await expect(asAdmin("select public.review_edit($1, $2)", [id, JSON.stringify({ to_party: "APC" })])).rejects.toThrow(/nothing to change/);
  });
});

describe("review_reject", () => {
  it("closes the event with a reason and changes no counts", async () => {
    const id = await review();
    await asAdmin("select public.review_reject($1, 'denied', 'He denied it the next day')", [id]);
    expect(await event(id)).toMatchObject({ status: "rejected", reviewed_by: ADMIN_ID, review_note: "He denied it the next day" });
    expect((await legislator(db, "Barnabas Okeyode")).party).toBe("PDP");
    expect(await feedback(id)).toMatchObject([{ action: "reject", reason_code: "denied", after: { status: "rejected" } }]);
  });

  it("requires a valid reason, and a note for 'other'", async () => {
    const id = await review();
    await expect(asAdmin("select public.review_reject($1, 'boring')", [id])).rejects.toThrow(/rejection reason is required/);
    await expect(asAdmin("select public.review_reject($1, 'other')", [id])).rejects.toThrow(/explain the rejection/);
  });
});

describe("review_merge", () => {
  it("moves sources to the target and closes the duplicate", async () => {
    const target = await createEvent(db, { name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-09-14" });
    await addSource(db, target, "https://example.org/a");
    await publish(db, target);
    const dup = await review();
    await addSource(db, dup, "https://example.org/b");

    await asAdmin("select public.review_merge($1, $2)", [dup, target]);
    expect(await event(dup)).toMatchObject({ status: "rejected" });
    expect((await event(dup)).review_note).toBe(`Merged into ${target}.`);
    const sources = await rows<{ url: string }>(
      db,
      "select a.url from event_sources es join articles a on a.id = es.article_id where es.event_id = $1 order by a.url",
      [target],
    );
    expect(sources.map((s) => s.url)).toEqual(["https://example.org/a", "https://example.org/b"]);
    expect(await feedback(dup)).toMatchObject([{ action: "merge", reason_code: "duplicate", after: { merged_into: target } }]);
  });

  it("refuses to merge an event into itself or into a rejected event", async () => {
    const a = await review();
    await expect(asAdmin("select public.review_merge($1, $1)", [a])).rejects.toThrow(/into itself/);
    const rejected = await createEvent(db, { name: "Barnabas Okeyode", from: "PDP", to: "APC", status: "rejected" });
    await expect(asAdmin("select public.review_merge($1, $2)", [a, rejected])).rejects.toThrow(/status rejected/);
  });
});

describe("permissions", () => {
  it.each([
    ["review_approve", "select public.review_approve($1)"],
    ["review_edit", "select public.review_edit($1, '{\"to_party\":\"LP\"}')"],
    ["review_reject", "select public.review_reject($1, 'rumour')"],
    ["review_merge", "select public.review_merge($1, gen_random_uuid())"],
  ])("%s is refused to anon and to signed-in users who are not admins", async (_name, sql) => {
    const id = await review();
    await expect(asRole(db, "anon", (tx) => tx.query(sql, [id]))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "authenticated", (tx) => tx.query(sql, [id]), userClaims)).rejects.toThrow(/not authorised/);
    expect(await event(id)).toMatchObject({ status: "in_review" });
  });

  it("keeps the helpers off the API", async () => {
    const id = await review();
    for (const sql of ["select public.review_lock($1)", "select public.review_apply_edits($1, '{}')"]) {
      await expect(asRole(db, "authenticated", (tx) => tx.query(sql, [id]), adminClaims)).rejects.toThrow(/permission denied/);
    }
  });
});
