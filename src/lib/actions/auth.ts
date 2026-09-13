"use server";

import { redirect } from "next/navigation";

import { generateUniqueJoinCode } from "@/lib/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { credentialsSchema, firstIssue, teacherSignupSchema } from "@/lib/validation";
import { formError, type FormState } from "./form-state";

/**
 * Authentication.
 *
 * Students do not have email addresses in this product, so a teacher provisions
 * an account with a handle and the server mints an internal, undeliverable
 * address for it (`<handle>@<STUDENT_EMAIL_DOMAIN>`). The credential a student
 * holds is handle + password; a student ID on its own is never enough to sign in.
 */

const GENERIC_CREDENTIALS_ERROR =
  "Those credentials were not accepted. Check the handle or email and password your teacher gave you.";

export async function signInAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentialsSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));

  const { identifier, password } = parsed.data;
  const nextPath = String(formData.get("next") ?? "").trim();

  // A handle is resolved to its internal email server-side. The lookup result is
  // deliberately not distinguished from a wrong password in the response, so the
  // form cannot be used to enumerate which handles exist.
  let email: string | null = null;
  if (identifier.includes("@")) {
    email = identifier.toLowerCase();
  } else {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("login_handle", identifier.trim().toLowerCase())
      .maybeSingle();
    email = profile?.email ?? null;
  }

  if (!email) return formError(GENERIC_CREDENTIALS_ERROR);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    // Supabase returns a generic "Invalid login credentials" here; surface the
    // same copy either way.
    return formError(GENERIC_CREDENTIALS_ERROR);
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  const fallback = profile?.role === "teacher" ? "/teacher" : "/student";
  const destination =
    nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : fallback;

  redirect(destination);
}

export async function signUpTeacherAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = teacherSignupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    classroomName: formData.get("classroomName"),
    section: formData.get("section") ?? "",
    startingCapital: formData.get("startingCapital"),
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));

  const { fullName, email, password, classroomName, section, startingCapital } =
    parsed.data;

  const admin = createAdminClient();

  // The account is created already-confirmed. A classroom simulator has no
  // transactional email of its own, and Supabase's shared SMTP would leave the
  // teacher staring at an unverified-email wall. For a public deployment you
  // would enable confirmation here; the trade-off is called out in README.md.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "teacher", full_name: fullName },
  });

  if (createError || !created.user) {
    const alreadyExists =
      createError?.message?.toLowerCase().includes("already") ?? false;
    return formError(
      alreadyExists
        ? "An account already exists for that email address. Sign in instead."
        : "Could not create that account. Please try again.",
    );
  }

  const userId = created.user.id;

  // Belt and braces: the on_auth_user_created trigger normally inserts this row.
  await admin
    .from("profiles")
    .upsert(
      { id: userId, role: "teacher", full_name: fullName, email },
      { onConflict: "id" },
    );

  const joinCode = await generateUniqueJoinCode();

  const { data: classroom, error: classroomError } = await admin
    .from("classrooms")
    .insert({
      teacher_id: userId,
      name: classroomName,
      section: section || null,
      join_code: joinCode,
    })
    .select("id")
    .single();

  if (classroomError || !classroom) {
    return formError(
      "Your account was created, but the classroom could not be set up. Sign in and create one from the dashboard.",
    );
  }

  // The on_classroom_created trigger inserts the settings row; set the class's
  // starting capital on it — but only when the teacher actually chose one.
  // Absent means "leave the zero default", never an assumed amount.
  if (startingCapital !== undefined) {
    await admin
      .from("class_settings")
      .update({ default_starting_capital: startingCapital.toString() })
      .eq("classroom_id", classroom.id);
  }

  // Establish the session so the teacher lands straight in the dashboard.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    redirect("/login");
  }

  redirect("/teacher");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

