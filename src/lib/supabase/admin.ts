import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";

/**
 * Service-role client. This key bypasses Row Level Security, so this module must
 * never be imported into a client component and the client it returns must never
 * be handed to the browser.
 *
 * Used only for:
 *  - provisioning and managing student auth accounts (Auth Admin API)
 *  - calling the SECURITY DEFINER trading RPCs, after the calling server action
 *    has established who the user is and what they are allowed to do
 *  - writing server-side market-cache rows
 */
export function createAdminClient() {
  return createSupabaseClient(serverEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "paperdesk-server" },
    },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
