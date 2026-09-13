"use server";

import { revalidatePath } from "next/cache";

import { isClassroomStudent } from "@/lib/auth/guards";
import { requireStudent } from "@/lib/auth/session";
import { getQuotes } from "@/lib/market/service";
import { loadHeldSymbols } from "@/lib/data/queries";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Refreshes the sampled prices behind a student's portfolio and records a
 * snapshot, so the performance chart gains a real point.
 *
 * Form-action signature (FormData in, nothing out) because it is wired straight
 * to a button. Failures are intentionally silent here: the page re-renders from
 * the database, and if the provider was down the figures simply stay as they
 * were rather than becoming wrong.
 */
export async function refreshStudentMarketAction(formData: FormData): Promise<void> {
  const session = await requireStudent();
  const classroomId = String(formData.get("classroomId") ?? "");

  if (!classroomId || !(await isClassroomStudent(classroomId, session.userId))) {
    return;
  }

  const symbols = await loadHeldSymbols(classroomId);

  // Also refresh the asset the student is currently looking at, so a detail page
  // always has a current price even before anything is held.
  const focusSymbol = String(formData.get("symbol") ?? "").trim();
  if (focusSymbol) symbols.push(focusSymbol);

  if (symbols.length > 0) await getQuotes(symbols);

  const admin = createAdminClient();
  await admin.rpc("capture_snapshots", {
    p_classroom_id: classroomId,
    p_student_id: session.userId,
  });

  revalidatePath("/student", "layout");
}
