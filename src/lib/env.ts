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
   * Comma-separated teacher invite codes. When set, creating a teacher account
   * requires one of them; when unset, anyone may register as a teacher (the
   * original behaviour, kept for local development).
   */
  get teacherInviteCodes() {
    const raw = process.env.TEACHER_INVITE_CODES ?? "";
    return raw
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code.length > 0);
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
  /**
   * Alpha Vantage news key — server only. This provider takes its key as a
   * query parameter rather than a header, so the URL carrying it must never
   * reach a log line, an error message or a response body.
   */
  get alphaVantageApiKey() {
    return required("ALPHA_VANTAGE_API_KEY", process.env.ALPHA_VANTAGE_API_KEY);
  },
  /**
   * Ceiling on Alpha Vantage calls per UTC day.
   *
   * The free tier allows 25 requests/day *in total*, shared by every student in
   * every classroom, so the app has to budget deliberately rather than discover
   * the limit by hitting it. Raise this if the key is on a paid plan.
   *
   * An explicit `0` is honoured as "stop calling out entirely" — cached news is
   * still served. Only an absent or unparseable value falls back to the default,
   * so setting the variable to zero is a usable switch rather than a no-op.
   */
  get alphaVantageDailyBudget() {
    const raw = process.env.ALPHA_VANTAGE_DAILY_BUDGET?.trim();
    if (!raw) return 20;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 20;
    return Math.min(Math.floor(parsed), 100000);
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

/** True when an Alpha Vantage key is present, without throwing. */
export function hasAlphaVantageKey(): boolean {
  return Boolean(process.env.ALPHA_VANTAGE_API_KEY?.trim());
}
