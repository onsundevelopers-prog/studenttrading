"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { NOT_MEMBER_MESSAGE, isClassroomStudent } from "@/lib/auth/guards";
import { ACTIVE_CLASSROOM_COOKIE, requireStudent } from "@/lib/auth/session";
import { ensureAsset } from "@/lib/market/service";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  firstIssue,
  removeWatchlistItemSchema,
  selectClassroomSchema,
  watchlistSchema,
} from "@/lib/validation";
import { formError, formSuccess, type FormState } from "./form-state";

export async function selectStudentClassroomAction(formData: FormData): Promise<void> {
  const session = await requireStudent();
  const parsed = selectClassroomSchema.safeParse({
    classroomId: formData.get("classroomId"),
    next: formData.get("next") ?? "",
  });
  if (!parsed.success) return;

  if (!(await isClassroomStudent(parsed.data.classroomId, session.userId))) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLASSROOM_COOKIE, parsed.data.classroomId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });

  revalidatePath("/student", "layout");
  if (parsed.data.next) redirect(parsed.data.next);
}

/** Finds, or lazily creates, this student's watchlist for a classroom. */
async function ensureWatchlist(
  classroomId: string,
  studentId: string,
): Promise<string | null> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("watchlists")
    .select("id")
    .eq("classroom_id", classroomId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created } = await admin
    .from("watchlists")
    .insert({ classroom_id: classroomId, student_id: studentId, name: "Watchlist" })
    .select("id")
    .single();

  return created?.id ?? null;
}

export async function addToWatchlistAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireStudent();

  const parsed = watchlistSchema.safeParse({
    classroomId: formData.get("classroomId"),
    symbol: formData.get("symbol"),
  });
  if (!parsed.success) return formError(firstIssue(parsed.error));

  const { classroomId, symbol } = parsed.data;
  if (!(await isClassroomStudent(classroomId, session.userId))) {
    return formError(NOT_MEMBER_MESSAGE);
  }

  const asset = await ensureAsset(symbol);
  if (!asset.ok) return formError(asset.reason);

  const watchlistId = await ensureWatchlist(classroomId, session.userId);
  if (!watchlistId) return formError("Could not create a watchlist.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("watchlist_items")
    .upsert(
      { watchlist_id: watchlistId, asset_id: asset.assetId },
      { onConflict: "watchlist_id,asset_id", ignoreDuplicates: true },
    );

  if (error) return formError("Could not add that asset to your watchlist.");

  revalidatePath("/student", "layout");
  return formSuccess("Added to your watchlist.");
}

/** Button-shaped wrappers for plain `<form action>` usage on the dashboards. */
export async function addToWatchlistFormAction(formData: FormData): Promise<void> {
  await addToWatchlistAction(null, formData);
}

export async function removeWatchlistItemFormAction(
  formData: FormData,
): Promise<void> {
  await removeWatchlistItemAction(null, formData);
}

export async function removeWatchlistItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireStudent();

  const parsed = removeWatchlistItemSchema.safeParse({
    classroomId: formData.get("classroomId"),
    itemId: formData.get("itemId"),
  });
  if (!parsed.success) return formError(firstIssue(parsed.error));

  const { classroomId, itemId } = parsed.data;
  if (!(await isClassroomStudent(classroomId, session.userId))) {
    return formError(NOT_MEMBER_MESSAGE);
  }

  const admin = createAdminClient();

  // Scope the delete to this student's own watchlists so an item id from
  // somebody else's list cannot be deleted by passing it in.
  const { data: owned } = await admin
    .from("watchlist_items")
    .select("id, watchlists!inner ( student_id, classroom_id )")
    .eq("id", itemId)
    .eq("watchlists.student_id", session.userId)
    .eq("watchlists.classroom_id", classroomId)
    .maybeSingle();

  if (!owned) return formError("That item is not on your watchlist.");

  const { error } = await admin.from("watchlist_items").delete().eq("id", itemId);
  if (error) return formError("Could not remove that asset.");

  revalidatePath("/student", "layout");
  return formSuccess("Removed from your watchlist.");
}
