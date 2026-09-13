import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Credential helpers.
 *
 * These live outside the `"use server"` modules on purpose: a module with that
 * directive may only export async functions, and these are plain utilities that
 * must not be reachable as standalone endpoints.
 */

/**
 * A readable, high-entropy temporary password.
 *
 * The alphabet omits 0/O/1/I/L because these get written on a whiteboard or read
 * aloud across a classroom, and a mis-transcribed password is a support ticket.
 * Twelve characters from a 31-symbol alphabet is roughly 59 bits.
 */
export function generateTemporaryPassword(groups = 3): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(groups * 4);
  crypto.getRandomValues(bytes);

  const parts: string[] = [];
  for (let group = 0; group < groups; group += 1) {
    let part = "";
    for (let index = 0; index < 4; index += 1) {
      part += alphabet[bytes[group * 4 + index] % alphabet.length];
    }
    parts.push(part);
  }
  return parts.join("-");
}

/** Six characters, same ambiguity-free alphabet. */
export async function generateUniqueJoinCode(): Promise<string> {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const admin = createAdminClient();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const code = Array.from(
      bytes,
      (byte) => alphabet[byte % alphabet.length],
    ).join("");

    const { data } = await admin
      .from("classrooms")
      .select("id")
      .eq("join_code", code)
      .maybeSingle();

    if (!data) return code;
  }

  throw new Error("Could not allocate a unique class code. Please try again.");
}

/** `<handle>@<STUDENT_EMAIL_DOMAIN>` — internal, never emailed. */
export function studentEmailFor(handle: string, domain: string): string {
  return `${handle.trim().toLowerCase()}@${domain}`;
}

export function slugifyHandle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^[._-]+/, "")
    .slice(0, 32);
}
