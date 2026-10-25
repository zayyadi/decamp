"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { buildEdits, REJECT_REASONS, reviewErrorMessage, safeNext } from "@/lib/review";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; message: string } | null;

const uuid = z.uuid();
const note = z.string().trim().max(1000).optional();
const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : undefined;
};

export async function signIn(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ email: z.email(), password: z.string().min(1) })
    .safeParse({ email: field(form, "email"), password: field(form, "password") });
  if (!parsed.success) return { ok: false, message: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Don't say which part was wrong.
  if (error) return { ok: false, message: "That email and password don't match an account." };
  redirect(safeNext(field(form, "next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

/** Runs an admin RPC; the SQL function re-checks the role and does the work in one transaction. */
async function run(fn: string, args: Record<string, unknown>, success: string): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: reviewErrorMessage("not authorised") };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: reviewErrorMessage(error.message) };
  refresh();
  return { ok: true, message: success };
}

function editsFrom(form: FormData) {
  const original = {
    legislator_id: field(form, "orig_legislator_id") || null,
    from_party: field(form, "orig_from_party") || null,
    to_party: field(form, "orig_to_party") || null,
    event_date: field(form, "orig_event_date") || null,
  };
  return buildEdits(original, {
    legislator_id: field(form, "legislator_id"),
    from_party: field(form, "from_party"),
    to_party: field(form, "to_party"),
    event_date: field(form, "event_date"),
  });
}

export async function approveEvent(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = uuid.safeParse(field(form, "event_id"));
  if (!id.success) return { ok: false, message: "Unknown event." };
  return run(
    "review_approve",
    { p_event_id: id.data, p_edits: editsFrom(form), p_note: note.parse(field(form, "note")) ?? null },
    "Approved and published.",
  );
}

export async function saveEdits(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = uuid.safeParse(field(form, "event_id"));
  if (!id.success) return { ok: false, message: "Unknown event." };
  return run("review_edit", { p_event_id: id.data, p_edits: editsFrom(form), p_note: note.parse(field(form, "note")) ?? null }, "Changes saved.");
}

export async function rejectEvent(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, reason: z.enum(REJECT_REASONS.map((r) => r.value)), note })
    .safeParse({ id: field(form, "event_id"), reason: field(form, "reason"), note: field(form, "note") });
  if (!parsed.success) return { ok: false, message: "Pick a reason for rejecting." };
  return run("review_reject", { p_event_id: parsed.data.id, p_reason: parsed.data.reason, p_note: parsed.data.note || null }, "Rejected.");
}

export async function mergeEvent(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, target: uuid, note })
    .safeParse({ id: field(form, "event_id"), target: field(form, "target_id")?.trim(), note: field(form, "note") });
  if (!parsed.success) return { ok: false, message: "Choose the event to merge into, or paste its ID." };
  return run(
    "review_merge",
    { p_event_id: parsed.data.id, p_target_id: parsed.data.target, p_note: parsed.data.note || null },
    "Merged into the original event.",
  );
}

export async function reverseEvent(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ id: uuid, note: z.string().trim().min(10).max(1000) })
    .safeParse({ id: field(form, "event_id"), note: field(form, "note") });
  if (!parsed.success) return { ok: false, message: "Explain the correction in at least 10 characters; it is shown publicly." };
  return run("reverse_defection", { p_event_id: parsed.data.id, p_note: parsed.data.note }, "Reversed. A correction alert was published.");
}
