"use server";

import { redirect } from "next/navigation";

import {
  generateUniqueJoinCode,
  studentEmailFor,
} from "@/lib/credentials";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  credentialsSchema,
  firstIssue,
  studentSignupByCodeSchema,
  teacherSignupSchema,
} from "@/lib/validation";
import { formError, formSuccess, type FormState } from "./form-state";

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
    inviteCode: formData.get("inviteCode") ?? "",
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));

  const { fullName, email, password, classroomName, section, startingCapital, inviteCode } =
    parsed.data;

  // Teacher verification (invite codes). The list lives in the environment, so
  // the check happens here and nowhere else — the form field being optional is
  // a UI convenience, never an authorisation decision. Codes are compared
  // case-insensitively because they get read aloud and typed by hand.
  const validCodes = serverEnv.teacherInviteCodes;
  if (validCodes.length > 0) {
    const submitted = inviteCode.trim().toLowerCase();
    const matched = validCodes.some((code) => code.toLowerCase() === submitted);
    if (!matched) {
      return formError(
        "A valid invite code is required to create a teacher account. Ask the person who set up this site for one.",
      );
    }
  }

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

/**
 * Self-serve student signup with a class code.
 *
 * A student who has a code joins without the teacher typing them into a roster:
 * the code is resolved server-side to its classroom, the class's default
 * starting capital is used (zero unless the teacher set one), and the same
 * provisioning path as `addStudentsAction` is followed — internal undeliverable
 * email, handle + password credential, `class_members` row. Nothing is
 * invented: capital comes from the classroom's settings, never from this form.
 *
 * The whole flow re-checks the handle and membership before every write, so a
 * double-submitted form cannot create two accounts.
 */
export async function joinClassByCodeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = studentSignupByCodeSchema.safeParse({
    classCode: formData.get("classCode"),
    fullName: formData.get("fullName"),
    handle: formData.get("handle"),
    password: formData.get("password"),
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));

  const { classCode, fullName, handle, password } = parsed.data;

  const admin = createAdminClient();

  // Resolve the code to a classroom. An unknown code fails with one message,
  // so codes cannot be probed by differences in the response.
  const { data: classroom } = await admin
    .from("classrooms")
    .select("id")
    .eq("join_code", classCode)
    .maybeSingle();

  if (!classroom) {
    return formError("That class code was not recognised. Check it with your teacher.");
  }

  const { data: settings } = await admin
    .from("class_settings")
    .select("default_starting_capital")
    .eq("classroom_id", classroom.id)
    .maybeSingle();

  // Zero unless the teacher explicitly set a class default. Never invented.
  const startingCapital = Number(settings?.default_starting_capital ?? 0);

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("login_handle", handle)
    .maybeSingle();

  let studentId: string;
  let isNewAccount = false;

  if (existingProfile) {
    if (existingProfile.role !== "student") {
      return formError("That handle is already in use. Choose another.");
    }

    // Already in this class? Then there is nothing to create: tell them to sign
    // in, without confirming anything about the existing account.
    const { data: membership } = await admin
      .from("class_members")
      .select("student_id")
      .eq("classroom_id", classroom.id)
      .eq("student_id", existingProfile.id)
      .maybeSingle();

    if (membership) {
      return formError(
        "That handle is already enrolled in this class — sign in instead.",
      );
    }

    // Enrolled elsewhere: reuse the profile, but the password they typed is NOT
    // applied (we cannot verify it against the existing account). They keep
    // signing in with the credential their original teacher issued.
    studentId = existingProfile.id;

    const { error: memberError } = await admin.from("class_members").insert({
      classroom_id: classroom.id,
      student_id: studentId,
      display_name: fullName,
      cash_balance: startingCapital.toString(),
      initial_capital: startingCapital.toString(),
      status: "active",
    });

    if (memberError) {
      if (memberError.code === "23505") {
        return formError("You are already enrolled in this class.");
      }
      return formError("Could not join the class. Please try again.");
    }
  } else {
    isNewAccount = true;
    const email = studentEmailFor(handle, serverEnv.studentEmailDomain);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "student",
        full_name: fullName,
        login_handle: handle,
      },
    });

    if (createError || !created.user) {
      return formError("Could not create that account. Please try again.");
    }

    studentId = created.user.id;

    // The on_auth_user_created trigger inserts the profile; make sure the
    // handle is stored (same belt-and-braces as teacher provisioning).
    await admin
      .from("profiles")
      .upsert(
        {
          id: studentId,
          role: "student",
          full_name: fullName,
          login_handle: handle,
          email,
        },
        { onConflict: "id" },
      );

    const { error: newMemberError } = await admin.from("class_members").insert({
      classroom_id: classroom.id,
      student_id: studentId,
      display_name: fullName,
      cash_balance: startingCapital.toString(),
      initial_capital: startingCapital.toString(),
      status: "active",
    });

    if (newMemberError) {
      if (newMemberError.code === "23505") {
        // Raced with a parallel submission: the membership already exists.
        return formError("You are already enrolled in this class.");
      }

      // The auth user exists but enrolment failed — clean up the orphan.
      await admin.auth.admin.deleteUser(studentId);
      return formError("Could not join the class. Please try again.");
    }
  }

  // Only a brand-new account can be signed in here: its password is the one
  // this form just set. A reused profile keeps the credential issued by the
  // teacher who enrolled them the first time, so send them to sign in.
  if (!isNewAccount) {
    return formSuccess(
      "You are enrolled in the class. Sign in with the password your teacher gave you.",
    );
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: studentEmailFor(handle, serverEnv.studentEmailDomain),
    password,
  });

  if (signInError) {
    redirect("/login");
  }

  redirect("/student");
}