import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on every matched request. Server
 * Components cannot write cookies, so without this an expiring token would leave
 * the user silently signed out.
 *
 * (Next.js 16 renamed the `middleware` convention to `proxy`; the entry point is
 * /src/proxy.ts.)
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be getUser(), not getSession(): getUser revalidates the token with the
  // auth server rather than trusting the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
