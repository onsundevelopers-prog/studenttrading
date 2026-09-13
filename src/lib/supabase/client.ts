"use client";

import { createBrowserClient } from "@supabase/ssr";

import { assertPublicEnv, publicEnv } from "@/lib/env";

/**
 * Browser client. Authenticates only — it is used to read the current session on
 * the client so the UI can react to sign-out. It carries the publishable key,
 * which is safe to expose, and every table it touches is protected by RLS.
 */
export function createClient() {
  assertPublicEnv();
  return createBrowserClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
  );
}
