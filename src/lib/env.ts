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
  /**
   * Alpaca keys — server only. The secret is required whenever any Alpaca
   * variable is set, so a half-configured environment fails loudly here rather
   * than mysteriously at first request.
   */
  get alpacaApiKey() {
    return required("ALPACA_API_KEY", process.env.ALPACA_API_KEY);
  },
  get alpacaSecretKey() {
    return required("ALPACA_SECRET_KEY", process.env.ALPACA_SECRET_KEY);
  },
  /** Only the paper environment is supported, and only "true" is accepted. */
  get alpacaPaper() {
    const raw = (process.env.ALPACA_PAPER ?? "true").trim().toLowerCase();
    if (raw !== "true") {
      throw new Error(
        "ALPACA_PAPER must be \"true\". This product is a classroom simulator and " +
          "only ever talks to Alpaca's paper-trading environment.",
      );
    }
    return true;
  },
} as const;

/** True when Alpaca credentials are present, without throwing. */
export function hasAlpacaKeys(): boolean {
  return Boolean(
    process.env.ALPACA_API_KEY?.trim() && process.env.ALPACA_SECRET_KEY?.trim(),
  );
}

export function hasFinnhubKey(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}
