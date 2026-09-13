import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Authorisation checks used by every server action.
 *
 * These deliberately query ownership rows rather than trusting anything the
 * caller supplied. A hidden button is not a permission system; every mutation
 * re-verifies here, and the database re-verifies again where money is involved.
 */

export async function isClassroomTeacher(
  classroomId: string,
  userId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("classrooms")
    .select("id")
    .eq("id", classroomId)
    .eq("teacher_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function isClassroomStudent(
  classroomId: string,
  userId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("class_members")
    .select("id")
    .eq("classroom_id", classroomId)
    .eq("student_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}

export const FORBIDDEN_MESSAGE =
  "You don't have permission to access this resource.";

export const NOT_MEMBER_MESSAGE =
  "You are not enrolled in this classroom.";
