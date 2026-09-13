"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ACTIVE_CLASSROOM_COOKIE, requireTeacher } from "@/lib/auth/session";
import { FORBIDDEN_MESSAGE, isClassroomTeacher } from "@/lib/auth/guards";
import {
  generateTemporaryPassword,
  generateUniqueJoinCode,
  studentEmailFor,
} from "@/lib/credentials";
import { serverEnv } from "@/lib/env";
import { loadHeldSymbols } from "@/lib/data/queries";
import { sampleMarketAndSnapshot } from "@/lib/market/service";
import { parseRosterInput } from "@/lib/roster";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addStudentSchema,
  adjustCashSchema,
  classSettingsSchema,
  competitionSchema,
  createClassroomSchema,
  firstIssue,
  resetClassroomSchema,
  resetStudentSchema,
  selectClassroomSchema,
} from "@/lib/validation";
import type { ProvisionedStudent } from "@/lib/types";
import { formError, formSuccess, type FormState } from "./form-state";

function revalidateTeacher(): void {
  revalidatePath("/teacher", "layout");
  revalidatePath("/student", "layout");
}

export async function selectClassroomAction(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const parsed = selectClassroomSchema.safeParse({
    classroomId: formData.get("classroomId"),
    next: formData.get("next") ?? "",
  });
  if (!parsed.success) return;

  // Only allow switching to a classroom this teacher actually owns.
  if (!(await isClassroomTeacher(parsed.data.classroomId, session.userId))) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLASSROOM_COOKIE, parsed.data.classroomId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });

  revalidateTeacher();
  if (parsed.data.next) redirect(parsed.data.next);
}

export async function createClassroomAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const parsed = createClassroomSchema.safeParse({
    name: formData.get("name"),
    section: formData.get("section") ?? "",
    startingCapital: formData.get("startingCapital"),
  });
  if (!parsed.success) return formError(firstIssue(parsed.error));

  const joinCode = await generateUniqueJoinCode();
  const admin = createAdminClient();

  const { data: classroom, error } = await admin
    .from("classrooms")
    .insert({
      teacher_id: session.userId,
      name: parsed.data.name,
      section: parsed.data.section || null,
      join_code: joinCode,
    })
    .select("id")
    .single();

  if (error || !classroom) {
    return formError("Could not create that classroom. Please try again.");
  }

  // Only write a capital the teacher actually chose; absent leaves the zero
  // default set by the schema trigger.
  if (parsed.data.startingCapital !== undefined) {
    await admin
      .from("class_settings")
      .update({ default_starting_capital: parsed.data.startingCapital.toString() })
      .eq("classroom_id", classroom.id);
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLASSROOM_COOKIE, classroom.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });

  revalidateTeacher();
  redirect("/teacher/students");
}

// ---------------------------------------------------------------------------
// Student provisioning
// ---------------------------------------------------------------------------
export async function addStudentsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();

  const classroomId = String(formData.get("classroomId") ?? "");
  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const roster = parseRosterInput(String(formData.get("roster") ?? ""));
  if (roster.length === 0) {
    return formError("Add at least one student, one per line.");
  }
  if (roster.length > 200) {
    return formError("Add at most 200 students at a time.");
  }

  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("class_settings")
    .select("default_starting_capital")
    .eq("classroom_id", classroomId)
    .maybeSingle();

  const requestedCapital = String(formData.get("startingCapital") ?? "").trim();
  // An empty field means "use the class default", and an unconfigured class
  // default is zero. Capital is never invented here.
  const startingCapital =
    requestedCapital.length > 0
      ? Number(requestedCapital)
      : Number(settings?.default_starting_capital ?? 0);

  if (!Number.isFinite(startingCapital) || startingCapital < 0) {
    return formError("Starting capital must be zero or more.");
  }

  const provisioned: ProvisionedStudent[] = [];
  const problems: string[] = [];

  for (const line of roster) {
    const parsed = addStudentSchema.safeParse({
      fullName: line.fullName,
      handle: line.handle,
      externalId: line.externalId,
      startingCapital,
    });

    if (!parsed.success) {
      problems.push(`"${line.fullName}": ${firstIssue(parsed.error)}`);
      continue;
    }

    const { fullName, handle, externalId } = parsed.data;

    // Reuse an existing student profile if the handle is already taken, so a
    // student can be enrolled in a second classroom without a second account.
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id, role")
      .eq("login_handle", handle)
      .maybeSingle();

    let studentId: string;
    let temporaryPassword = "";

    if (existingProfile) {
      if (existingProfile.role !== "student") {
        problems.push(`"${handle}" is already in use by another account.`);
        continue;
      }
      studentId = existingProfile.id;
    } else {
      temporaryPassword = generateTemporaryPassword();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: studentEmailFor(handle, serverEnv.studentEmailDomain),
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          role: "student",
          full_name: fullName,
          login_handle: handle,
        },
      });

      if (createError || !created.user) {
        problems.push(
          `"${fullName}": could not create an account (${createError?.message ?? "unknown error"}).`,
        );
        continue;
      }

      studentId = created.user.id;

      // The trigger inserts the profile; make sure the handle is stored.
      await admin
        .from("profiles")
        .upsert(
          {
            id: studentId,
            role: "student",
            full_name: fullName,
            login_handle: handle,
            email: studentEmailFor(handle, serverEnv.studentEmailDomain),
          },
          { onConflict: "id" },
        );
    }

    const { error: memberError } = await admin.from("class_members").insert({
      classroom_id: classroomId,
      student_id: studentId,
      display_name: fullName,
      external_id: externalId || null,
      cash_balance: startingCapital.toString(),
      initial_capital: startingCapital.toString(),
      status: "active",
    });

    if (memberError) {
      const duplicate = memberError.code === "23505";
      problems.push(
        duplicate
          ? `"${fullName}" is already enrolled in this class.`
          : `"${fullName}": could not enroll (${memberError.message}).`,
      );
      continue;
    }

    if (temporaryPassword) {
      provisioned.push({
        studentId,
        fullName,
        handle,
        externalId: externalId || null,
        temporaryPassword,
      });
    }
  }

  revalidateTeacher();

  if (provisioned.length === 0 && problems.length > 0) {
    return formError(problems.join(" "));
  }

  return formSuccess(
    `${provisioned.length} student account${provisioned.length === 1 ? "" : "s"} created.` +
      (problems.length > 0 ? ` ${problems.length} skipped: ${problems.join(" ")}` : ""),
    { credentials: provisioned, startingCapital },
  );
}

export async function resetStudentPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const classroomId = String(formData.get("classroomId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");

  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const admin = createAdminClient();

  // Confirm the student really is in this teacher's classroom before touching
  // their account.
  const { data: membership } = await admin
    .from("class_members")
    .select("student_id")
    .eq("classroom_id", classroomId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (!membership) return formError(FORBIDDEN_MESSAGE);

  const temporaryPassword = generateTemporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(studentId, {
    password: temporaryPassword,
  });

  if (error) return formError("Could not reset that password. Please try again.");

  const { data: profile } = await admin
    .from("profiles")
    .select("login_handle, full_name")
    .eq("id", studentId)
    .maybeSingle();

  return formSuccess("Password reset. Hand the new password to the student.", {
    credentials: [
      {
        studentId,
        fullName: profile?.full_name ?? "",
        handle: profile?.login_handle ?? "",
        externalId: null,
        temporaryPassword,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Class controls
// ---------------------------------------------------------------------------
export async function updateClassSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const parsed = classSettingsSchema.safeParse({
    classroomId: formData.get("classroomId"),
    tradingEnabled: formData.get("tradingEnabled") === "on",
    pausedReason: formData.get("pausedReason") ?? "",
    tradingOpensAt: formData.get("tradingOpensAt") ?? "",
    tradingClosesAt: formData.get("tradingClosesAt") ?? "",
    assetPolicy: formData.get("assetPolicy") ?? "all",
    maxTradeValue: (formData.get("maxTradeValue") ?? "") as string | number,
    maxPositionPercent: (formData.get("maxPositionPercent") ?? "") as string | number,
    allowFractional: formData.get("allowFractional") === "on",
    allowedOrderTypes: formData.getAll("allowedOrderTypes").map(String),
    enforceMarketHours: formData.get("enforceMarketHours") === "on",
    allowExtendedHours: formData.get("allowExtendedHours") === "on",
    cryptoEnabled: formData.get("cryptoEnabled") === "on",
    shortSellingEnabled: formData.get("shortSellingEnabled") === "on",
    optionsEnabled: formData.get("optionsEnabled") === "on",
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));

  const { classroomId } = parsed.data;
  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const opens = parsed.data.tradingOpensAt ? new Date(parsed.data.tradingOpensAt) : null;
  const closes = parsed.data.tradingClosesAt ? new Date(parsed.data.tradingClosesAt) : null;

  if (opens && Number.isNaN(opens.getTime())) return formError("Invalid opening time.");
  if (closes && Number.isNaN(closes.getTime())) return formError("Invalid closing time.");
  if (opens && closes && closes <= opens) {
    return formError("The trading window must close after it opens.");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("class_settings")
    .update({
      trading_enabled: parsed.data.tradingEnabled,
      paused_reason: parsed.data.pausedReason || null,
      trading_opens_at: opens?.toISOString() ?? null,
      trading_closes_at: closes?.toISOString() ?? null,
      asset_policy: parsed.data.assetPolicy,
      max_trade_value:
        parsed.data.maxTradeValue === ""
          ? null
          : String(parsed.data.maxTradeValue),
      max_position_percent:
        parsed.data.maxPositionPercent === ""
          ? null
          : String(parsed.data.maxPositionPercent),
      allow_fractional: parsed.data.allowFractional,
      allowed_order_types:
        parsed.data.allowedOrderTypes.length > 0
          ? parsed.data.allowedOrderTypes
          : ["market"],
      enforce_market_hours: parsed.data.enforceMarketHours,
      allow_extended_hours: parsed.data.allowExtendedHours,
      crypto_enabled: parsed.data.cryptoEnabled,
      short_selling_enabled: parsed.data.shortSellingEnabled,
      // Options are always hard-disabled in the engine; the flag exists so the
      // teacher control is honest about what the class is allowed to try.
      options_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("classroom_id", classroomId);

  if (error) return formError("Could not save those settings.");

  revalidateTeacher();
  return formSuccess(
    parsed.data.tradingEnabled
      ? "Settings saved. Trading is open."
      : "Settings saved. Trading is paused for this class.",
  );
}

/** Replaces the classroom's allow-list with the given asset ids. */
export async function setClassroomAssetsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const classroomId = String(formData.get("classroomId") ?? "");
  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const assetIds = formData
    .getAll("assetIds")
    .map((value) => String(value))
    .filter((value) => value.length > 0);

  const admin = createAdminClient();

  await admin.from("classroom_assets").delete().eq("classroom_id", classroomId);

  if (assetIds.length > 0) {
    const { error } = await admin.from("classroom_assets").insert(
      assetIds.map((assetId) => ({ classroom_id: classroomId, asset_id: assetId })),
    );
    if (error) return formError("Could not save the permitted assets.");
  }

  revalidateTeacher();
  return formSuccess(
    assetIds.length === 0
      ? "Allow-list cleared. Every asset in the simulator is tradeable."
      : `${assetIds.length} asset${assetIds.length === 1 ? "" : "s"} permitted.`,
  );
}

export async function adjustCashAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const parsed = adjustCashSchema.safeParse({
    classroomId: formData.get("classroomId"),
    studentId: formData.get("studentId"),
    delta: formData.get("delta"),
    reason: formData.get("reason") ?? "",
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));
  const { classroomId, studentId, delta, reason } = parsed.data;

  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const admin = createAdminClient();
  // grant_teacher_cash wraps adjust_cash and records the money as an explicit
  // teacher_credit / teacher_debit ledger event (spec §7).
  const { data, error } = await admin.rpc("grant_teacher_cash", {
    p_classroom_id: classroomId,
    p_student_id: studentId,
    p_delta: delta.toString(),
    p_reason: reason || null,
    p_actor_id: session.userId,
  });

  if (error) return formError("Could not adjust that balance.");

  const result = data as { ok: boolean; message?: string } | null;
  if (!result?.ok) {
    return formError(result?.message ?? "Could not adjust that balance.");
  }

  revalidateTeacher();
  return formSuccess("Balance adjusted. The change was recorded in the class record.");
}

export async function resetStudentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const parsed = resetStudentSchema.safeParse({
    classroomId: formData.get("classroomId"),
    studentId: formData.get("studentId"),
    startingCapital: formData.get("startingCapital") || undefined,
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));
  const { classroomId, studentId, startingCapital } = parsed.data;

  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reset_student_portfolio", {
    p_classroom_id: classroomId,
    p_student_id: studentId,
    p_starting_capital: startingCapital?.toString() ?? null,
    p_actor_id: session.userId,
  });

  if (error) return formError("Could not reset that portfolio.");

  const result = data as { ok: boolean; message?: string } | null;
  if (!result?.ok) return formError(result?.message ?? "Could not reset that portfolio.");

  revalidateTeacher();
  return formSuccess("Portfolio reset. Investments and trade history cleared.");
}

export async function resetClassroomAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const parsed = resetClassroomSchema.safeParse({
    classroomId: formData.get("classroomId"),
    startingCapital: formData.get("startingCapital") || undefined,
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));
  const { classroomId, startingCapital } = parsed.data;

  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reset_classroom", {
    p_classroom_id: classroomId,
    p_starting_capital: startingCapital?.toString() ?? null,
    p_actor_id: session.userId,
  });

  if (error) return formError("Could not reset that classroom.");

  const result = data as { ok: boolean; students_reset?: number } | null;
  if (!result?.ok) return formError("Could not reset that classroom.");

  revalidateTeacher();
  return formSuccess(
    `Simulation reset for ${result.students_reset ?? 0} students. Every portfolio is back to its starting capital.`,
  );
}

export async function createCompetitionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const parsed = competitionSchema.safeParse({
    classroomId: formData.get("classroomId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
  });

  if (!parsed.success) return formError(firstIssue(parsed.error));
  const { classroomId, name, description, startsAt, endsAt } = parsed.data;

  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return formError("Enter a valid start and end time.");
  }
  if (end <= start) return formError("The end time must be after the start time.");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_competition", {
    p_classroom_id: classroomId,
    p_name: name,
    p_description: description || null,
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_created_by: session.userId,
  });

  if (error) return formError("Could not create that competition.");

  const result = data as { ok: boolean; entries?: number; message?: string } | null;
  if (!result?.ok) return formError(result?.message ?? "Could not create that competition.");

  revalidateTeacher();
  return formSuccess(
    `Competition created with ${result.entries ?? 0} students entered.`,
  );
}

/** Refresh quotes for everything the class holds, then snapshot every student. */
export async function refreshMarketDataAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireTeacher();
  const classroomId = String(formData.get("classroomId") ?? "");
  if (!(await isClassroomTeacher(classroomId, session.userId))) {
    return formError(FORBIDDEN_MESSAGE);
  }

  const admin = createAdminClient();
  const { data: holdings } = await admin
    .from("holdings")
    .select("assets ( symbol )")
    .eq("classroom_id", classroomId)
    .gt("quantity", 0);

  const symbols = (holdings ?? [])
    .map((row) => {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      return asset?.symbol as string | undefined;
    })
    .filter((symbol): symbol is string => Boolean(symbol));

  const result = await sampleMarketAndSnapshot({ symbols });
  revalidateTeacher();

  if (result.sampled === 0 && result.failed > 0) {
    return formError(
      "Market data is temporarily unavailable. No prices were refreshed.",
    );
  }

  return formSuccess(
    `Refreshed ${result.sampled} price${result.sampled === 1 ? "" : "s"} and recorded ${result.snapshotted} portfolio value${result.snapshotted === 1 ? "" : "s"}.`,
  );
}

/**
 * Button-shaped wrapper around the same refresh, for a plain `<form action>`.
 * Silent on failure by design: the page re-renders from the database, and if the
 * provider was down the figures stay as they were rather than becoming wrong.
 */
export async function refreshMarketNowAction(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const classroomId = String(formData.get("classroomId") ?? "");
  if (!(await isClassroomTeacher(classroomId, session.userId))) return;

  const symbols = await loadHeldSymbols(classroomId);
  await sampleMarketAndSnapshot({ symbols });

  revalidateTeacher();
}
