import type { PGliteInterface } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEvent, createSeededDb, publish, setDemoMode } from "./fixtures";
import { ADMIN_ID, adminClaims, asRole, one, rows, userClaims } from "./harness";

let db: PGliteInterface;
beforeEach(async () => {
  db = await createSeededDb();
  await setDemoMode(db, true);
});
afterEach(() => db.close());

const asAdmin = <T>(sql: string, params: unknown[] = []) =>
  asRole(db, "authenticated", (tx) => rows<T>(tx, sql, params), adminClaims);

const SOURCE = "https://example.org/assembly-defection";

/** An unresolved state-assembly event, as the agent routes one to review. */
async function assemblyEvent(name = "Musa Danladi", state = "Kano", from = "NNPP", to = "APC") {
  const r = await one<{ id: string }>(
    db,
    `insert into defection_events (raw_name, from_party_id, to_party_id, event_type, event_date, chamber, state,
                                   confidence, status, evidence_quote, dedupe_key)
     select $1, fp.id, tp.id, 'CONFIRMED_DEFECTION', '2026-09-01', 'state_assembly', $2, 0.7, 'in_review',
            'The member formally joined the party.', 'test:assembly:' || $1
     from parties fp, parties tp where fp.code = $3 and tp.code = $4
     returning id`,
    [name, state, from, to],
  );
  return r.id;
}

const addMember = (eventId: string, overrides: Partial<Record<string, unknown>> = {}) => {
  const a = { name: "Musa Danladi", state: "Kano", constituency: "Dala", elected: "NNPP", start: "2023-06-13", source: SOURCE, ...overrides };
  return asAdmin<{ id: string; chamber: string; state: string; party: string }>(
    `select l.id, l.chamber, l.state, p.code as party
     from public.review_add_member($1, $2, $3, $4, $5, $6, $7) l join parties p on p.id = l.current_party_id`,
    [eventId, a.name, a.state, a.constituency, a.elected, a.start, a.source],
  );
};

describe("state_assembly chamber", () => {
  it("is accepted for members and events, but not in the FCT", async () => {
    await expect(
      db.query(
        `insert into legislators (full_name, chamber, state, constituency, elected_party_id, current_party_id, is_fictional)
         select 'Area Councillor', 'state_assembly', 'FCT', 'AMAC', id, id, true from parties where code = 'APC'`,
      ),
    ).rejects.toThrow(/legislators_assembly_state/);
  });
});

describe("review_add_member", () => {
  it("adds the member, links the event, and approval then publishes it", async () => {
    const id = await assemblyEvent();
    const [member] = await addMember(id);
    expect(member).toMatchObject({ chamber: "state_assembly", state: "Kano", party: "NNPP" });
    const linked = await one<{ legislator_id: string; status: string }>(db, "select legislator_id, status from defection_events where id = $1", [id]);
    expect(linked).toEqual({ legislator_id: member.id, status: "in_review" });

    await asAdmin("select public.review_approve($1)", [id]);
    const after = await one<{ party: string; history: number }>(
      db,
      `select p.code as party, (select count(*)::int from party_affiliations where legislator_id = l.id) as history
       from legislators l join parties p on p.id = l.current_party_id where l.id = $1`,
      [member.id],
    );
    expect(after).toEqual({ party: "APC", history: 2 });
    const alert = await one<{ title: string }>(db, "select title from alerts where event_id = $1 and kind = 'published'", [id]);
    expect(alert.title).toBe("Hon. Musa Danladi (Dala, Kano State House of Assembly) defects from NNPP to APC");
    const fb = await rows<{ action: string; after: Record<string, unknown>; reviewer: string }>(
      db,
      "select action, after, reviewer::text from review_feedback where event_id = $1 order by id",
      [id],
    );
    expect(fb.map((f) => f.action)).toEqual(["edit", "approve"]);
    expect(fb[0]).toMatchObject({ reviewer: ADMIN_ID, after: { added_member: member.id, member_source: SOURCE } });
  });

  it("refuses without a source, outside the term, or for a seat already held", async () => {
    const id = await assemblyEvent();
    await expect(addMember(id, { source: "http://example.org" })).rejects.toThrow(/source URL \(https\)/);
    await expect(addMember(id, { start: "2023-01-01" })).rejects.toThrow(/term start/);
    await addMember(id);
    const other = await assemblyEvent("Ibrahim Sule");
    await expect(addMember(other, { name: "Ibrahim Sule" })).rejects.toThrow(/already holds Dala in Kano/);
  });

  it("only adds state-assembly members, and only to unlinked events", async () => {
    const federal = await createEvent(db, { name: "Barnabas Okeyode", from: "PDP", to: "APC", status: "in_review" });
    await expect(addMember(federal)).rejects.toThrow(/already linked/);
    const unlinkedFederal = await one<{ id: string }>(
      db,
      `insert into defection_events (raw_name, event_type, chamber, confidence, status, evidence_quote, dedupe_key)
       values ('Someone', 'CONFIRMED_DEFECTION', 'senate', 0.7, 'in_review', 'quote here', 'test:fed') returning id`,
    );
    await expect(addMember(unlinkedFederal.id)).rejects.toThrow(/only state-assembly members/);
  });

  it("is refused to anon and to signed-in users who are not admins", async () => {
    const id = await assemblyEvent();
    const sql = "select public.review_add_member($1, 'X Y', 'Kano', 'Dala', 'NNPP', '2023-06-13', 'https://example.org')";
    await expect(asRole(db, "anon", (tx) => tx.query(sql, [id]))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "authenticated", (tx) => tx.query(sql, [id]), userClaims)).rejects.toThrow(/not authorised/);
  });
});

describe("national views", () => {
  it("count the federal chambers only, unless state assemblies are asked for", async () => {
    const fed = await createEvent(db, { name: "Barnabas Okeyode", from: "PDP", to: "APC", date: "2026-09-14" });
    await publish(db, fed);
    const id = await assemblyEvent();
    await addMember(id);
    await asAdmin("select public.review_approve($1)", [id]);

    const total = async (chamber: string | null) =>
      (await asRole(db, "anon", (tx) => one<{ n: number }>(tx, "select total::int as n from public.defection_kpis($1)", [chamber]))).n;
    expect(await total(null)).toBe(1);
    expect(await total("senate")).toBe(1);
    expect(await total("state_assembly")).toBe(1);
  });
});
