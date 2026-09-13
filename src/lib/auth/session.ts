import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

export const ACTIVE_CLASSROOM_COOKIE = "pd_active_classroom";

export type SessionContext = {
  userId: string;
  email: string | null;
  profile: Profile;
};

/**
 * Resolves the signed-in user and their profile.
 *
 * The role is read from the `profiles` table, not from `user_metadata`, because
 * a user can edit their own metadata through the auth API. RLS already limits
 * this read to the caller's own row.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, login_handle, email")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    // The signup trigger should always have created this row. Self-heal rather
    // than dead-end the user on a broken account.
    const admin = createAdminClient();
    const { data: created } = await admin
      .from("profiles")
      .insert({
        id: user.id,
        role: user.user_metadata?.role === "teacher" ? "teacher" : "student",
        full_name: String(user.user_metadata?.full_name ?? ""),
        login_handle: user.user_metadata?.login_handle
          ? String(user.user_metadata.login_handle).toLowerCase()
          : null,
        email: user.email ?? null,
      })
      .select("id, role, full_name, login_handle, email")
      .maybeSingle();

    if (!created) return null;

    return {
      userId: user.id,
      email: user.email ?? null,
      profile: {
        id: created.id,
        role: created.role as Role,
        fullName: created.full_name,
        loginHandle: created.login_handle,
        email: created.email,
      },
    };
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: {
      id: profile.id,
      role: profile.role as Role,
      fullName: profile.full_name,
      loginHandle: profile.login_handle,
      email: profile.email,
    },
  };
}

export async function requireSession(nextPath = "/dashboard"): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return session;
}

export async function requireTeacher(): Promise<SessionContext> {
  const session = await requireSession("/teacher");
  if (session.profile.role !== "teacher") redirect("/student");
  return session;
}

export async function requireStudent(): Promise<SessionContext> {
  const session = await requireSession("/student");
  if (session.profile.role !== "student") redirect("/teacher");
  return session;
}

export type ClassroomSummary = {
  id: string;
  name: string;
  section: string | null;
  joinCode: string;
  teacherName?: string | null;
  isOwner: boolean;
};

/**
 * Classrooms this user can see, oldest first: the ones they teach, or the ones
 * they belong to. RLS backs this up — this query cannot return anything else.
 */
export async function listClassroomsFor(
  session: SessionContext,
): Promise<ClassroomSummary[]> {
  const supabase = await createClient();

  if (session.profile.role === "teacher") {
    const { data } = await supabase
      .from("classrooms")
      .select("id, name, section, join_code, teacher_id")
      .eq("teacher_id", session.userId)
      .order("created_at", { ascending: true });

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      section: row.section,
      joinCode: row.join_code,
      isOwner: true,
    }));
  }

  const { data } = await supabase
    .from("class_members")
    .select(
      "classroom_id, status, classrooms ( id, name, section, join_code, teacher_id )",
    )
    .eq("student_id", session.userId)
    .eq("status", "active");

  return (data ?? [])
    .map((row): ClassroomSummary | null => {
      const classroom = Array.isArray(row.classrooms)
        ? row.classrooms[0]
        : row.classrooms;
      if (!classroom) return null;
      return {
        id: classroom.id,
        name: classroom.name,
        section: classroom.section,
        joinCode: classroom.join_code,
        isOwner: false,
      };
    })
    .filter((item): item is ClassroomSummary => item !== null);
}

/**
 * Resolves the classroom the user is currently working in: the one stored in the
 * cookie if it is still valid, otherwise their first classroom.
 */
export async function resolveActiveClassroom(
  session: SessionContext,
  classrooms?: ClassroomSummary[],
): Promise<ClassroomSummary | null> {
  const available = classrooms ?? (await listClassroomsFor(session));
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  const cookieStore = await cookies();
  const stored = cookieStore.get(ACTIVE_CLASSROOM_COOKIE)?.value;
  const match = available.find((classroom) => classroom.id === stored);

  return match ?? available[0];
}
