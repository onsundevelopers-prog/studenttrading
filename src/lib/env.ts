/**
 * Environment access.
 *
 * Two deliberate rules:
 *  1. Secret values are only ever read through `serverEnv`, which is imported
 *     exclusively from server modules. Nothing here is prefixed NEXT_PUBLIC_, so
 *     the bundler cannot inline a secret into client JavaScript.
 *  2. A missing variable produces an actionable message naming the variable,
 *     rather than an obscure runtime failure later.
 */

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
} as const;

export function assertPublicEnv(): void {
  const missing: string[] = [];
  if (!publicEnv.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!publicEnv.supabasePublishableKey)
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env.local and fill in your Supabase project values.`,
    );
  }
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and set it. See README.md for setup.`,
    );
  }
  return value;
}

/**
 * Secrets. Only import this from server-only modules (server actions, route
 * handlers, and the lib files they call).
 */
export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
  },
  get finnhubApiKey() {
    return required("FINNHUB_API_KEY", process.env.FINNHUB_API_KEY);
  },
  get cronSecret() {
    return required("CRON_SECRET", process.env.CRON_SECRET);
  },
  get studentEmailDomain() {
    return process.env.STUDENT_EMAIL_DOMAIN ?? "students.classroom-trading.local";
  },
} as const;

export function hasFinnhubKey(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}
