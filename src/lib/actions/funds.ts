"use server";

import { revalidatePath } from "next/cache";

import {
  FORBIDDEN_MESSAGE,
  NOT_MEMBER_MESSAGE,
  isClassroomStudent,
  isClassroomTeacher,
} from "@/lib/auth/guards";
import { requireStudent, requireTeacher } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  decideFundRequestSchema,
  firstIssue,
  requestFundsSchema,
} from "@/lib/validation";
import { formError, formSuccess, type FormState } from "./form-state";

/**
 * Fund requests: the student-initiated counterpart to `adjustCashAction`.
 *
 * A student asks the class bank for capital; the teacher approves or denies.
 * Approval grants the cash through the SECURITY DEFINER `adjust_cash` engine,
 * which also moves `initial_capital`, so granted money never shows up as
 * trading performance. Every path re-verifies membership or ownership before
 * touching anything — the same belt-and-braces as the rest of the actions.
 */

/** Small enough to be a classroom number, large enough to be useful. */
const MAX_REQUEST_AMOUNT = 100_000;

export async function requestFundsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireStudent();

  const parsed = requestFundsSchema.safeParse({
    classroomId: formData.get("classroomId"),
    amount: String(formData.get("amount") ?? "").trim(),
    reason: formData.get("reason") ?? "",
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));
  const { classroomId, amount, reason } = parsed.data;

  if (!(await isClassroomStudent(classroomId, session.userId))) {
    return formError(NOT_MEMBER_MESSAGE);
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return formError("Enter an amount greater than zero.");
  }
  if (numericAmount > MAX_REQUEST_AMOUNT) {
    return formError(
      `Requests are capped at ${MAX_REQUEST_AMOUNT.toLocaleString("en-US")}. Ask your teacher for anything larger.`,
    );
  }

  const admin = createAdminClient();

  // Re-check membership under the service role before writing — the same
  // belt-and-braces as the provisioning actions.
  const { data: membership } = await admin
    .from("class_members")
    .select("id")
    .eq("classroom_id", classroomId)
    .eq("student_id", session.userId)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) return formError(NOT_MEMBER_MESSAGE);

  // The partial unique index rejects a second open request; catching the error
  // code keeps double-submits an honest message instead of a 500.
  const { error } = await admin.from("fund_requests").insert({
    classroom_id: classroomId,
    student_id: session.userId,
    amount: amount,
    reason: reason || null,
  });

  if (error) {
    if (error.code === "23505") {
      return formError(
        "You already have a request waiting. Your teacher will get to it.",
      );
    }
    return formError("Could not submit that request. Please try again.");
  }

  revalidatePath("/teacher", "layout");
  revalidatePath("/student", "layout");

  return formSuccess("Request sent. Your teacher can approve it from the roster.");
}

export async function decideFundRequestAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();

  const parsed = decideFundRequestSchema.safeParse({
    requestId: formData.get("requestId"),
    decision: formData.get("decision"),
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));
  const { requestId, decision } = parsed.data;

  const admin = createAdminClient();

  // Load the request first so we can check this teacher actually owns the
  // classroom it belongs to — the request id alone is caller-supplied.
  const { data: request } = await admin
    .from("fund_requests")
    .select("id, classroom_id, student_id, amount, status")
    .eq("id", requestId)
    .maybeSingle();

  if (!request) return formError("That request no longer exists.");
  if (request.status !== "pending") {
    return formError("That request was already decided.");
  }

  if (!(await isClassroomTeacher(request.classroom_id, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  if (decision === "denied") {
    const { error } = await admin
      .from("fund_requests")
      .update({
        status: "denied",
        decided_by: session.userId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending");

    if (error) return formError("Could not record that decision. Please try again.");

    revalidatePath("/teacher", "layout");
    revalidatePath("/student", "layout");
    return formSuccess("Request denied.");
  }

  // Approve: grant the cash through the trading engine's adjustment path so
  // initial_capital moves with it, then flip the status. The RLS policy on
  // fund_requests allows the teacher's own update; the grant uses the service
  // role because adjust_cash is restricted to it.
  const { data, error: grantError } = await admin.rpc("adjust_cash", {
    p_classroom_id: request.classroom_id,
    p_student_id: request.student_id,
    p_delta: request.amount.toString(),
    p_reason: "Class bank withdrawal (approved fund request)",
    p_actor_id: session.userId,
  });

  if (grantError) return formError("Could not grant that request. Please try again.");

  const grantResult = data as { ok: boolean; message?: string } | null;
  if (!grantResult?.ok) {
    return formError(grantResult?.message ?? "Could not grant that request.");
  }

  const { error: statusError } = await admin
    .from("fund_requests")
    .update({
      status: "approved",
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
      granted_amount: request.amount.toString(),
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (statusError) {
    // The money moved; the bookkeeping row is the only thing that failed.
    // Do not pretend otherwise.
    return formError(
      "The cash was granted, but the request could not be marked approved. Refresh and check the student's balance.",
    );
  }

  revalidatePath("/teacher", "layout");
  revalidatePath("/student", "layout");
  return formSuccess("Request approved and cash granted.");
}
