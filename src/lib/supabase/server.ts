import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { assertPublicEnv, publicEnv } from "@/lib/env";

/**
 * Session-bound client. Every query made with this client is subject to the Row
 * Level Security policies in the database, which is what actually enforces
 * "you may only read your own data". Prefer this over the service-role client
 * for reads.
 */
export async function createClient() {
  assertPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. The
            // middleware already refreshes the session on every request, so this
            // is safe to ignore.
          }
        },
      },
    },
  );
}

export type ServerClient = Awaited<ReturnType<typeof createClient>>;
