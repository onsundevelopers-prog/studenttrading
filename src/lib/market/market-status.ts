import {
  fetchAlpacaClock,
  isAlpacaConfigured,
} from "@/lib/market/alpaca";

/**
 * Market status service (spec §3).
 *
 * Combines two sources of truth:
 *  1. Alpaca's /clock, which knows the real US equity calendar (holidays,
 *     half-days, regular session). Preferred whenever credentials exist.
 *  2. A local deterministic session calculation as a fallback, so a network
 *     failure degrades to "we think it's closed" instead of an error.
 *
 * Crypto is deliberately exempt: it trades continuously (spec §12), so every
 * session value for crypto is "open".
 */

export type MarketSession =
  | "pre_market"
  | "regular"
  | "after_hours"
  | "closed";

export type MarketStatus = {
  session: MarketSession;
  /** Equity market? False for crypto, which is always open. */
  isEquity: boolean;
  /** Whether orders of the corresponding asset class may be placed now. */
  tradingAllowed: boolean;
  /** Human label for the UI badge. */
  label: string;
  nextChangeAt: string | null;
  /** True when the status came from Alpaca's clock rather than local logic. */
  source: "alpaca" | "local";
};

function fmtTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function labelFor(session: MarketSession, nextChangeAt: Date | null): string {
  switch (session) {
    case "pre_market":
      return nextChangeAt
        ? `Pre-market · opens ${fmtTime(nextChangeAt)} ET`
        : "Pre-market";
    case "regular":
      return nextChangeAt ? `Market open · closes ${fmtTime(nextChangeAt)} ET` : "Market open";
    case "after_hours":
      return nextChangeAt ? `After hours · opens ${fmtTime(nextChangeAt)} ET` : "After hours";
    case "closed":
      return nextChangeAt ? `Closed · opens ${fmtTime(nextChangeAt)} ET` : "Market closed";
  }
}

/**
 * Local session calculation in US/Eastern terms. US equity hours:
 *   pre-market 04:00–09:30, regular 09:30–16:00, after-hours 16:00–20:00,
 *   closed otherwise and all weekend. Holidays cannot be known locally —
 *   that is exactly why the Alpaca clock is preferred when configured.
 */
function localStatus(now = new Date()): MarketStatus {
  const eastern = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = eastern.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const minutesOfDay = hour * 60 + minute;

  const isWeekend = weekday === "Sat" || weekday === "Sun";
  const PRE_OPEN = 4 * 60;
  const OPEN = 9 * 60 + 30;
  const CLOSE = 16 * 60;
  const POST_CLOSE = 20 * 60;

  let session: MarketSession;
  if (isWeekend) session = "closed";
  else if (minutesOfDay >= OPEN && minutesOfDay < CLOSE) session = "regular";
  else if (minutesOfDay >= PRE_OPEN && minutesOfDay < OPEN) session = "pre_market";
  else if (minutesOfDay >= CLOSE && minutesOfDay < POST_CLOSE) session = "after_hours";
  else session = "closed";

  const tradingAllowed = session === "regular";

  return {
    session,
    isEquity: true,
    tradingAllowed,
    label: labelFor(session, null),
    nextChangeAt: null,
    source: "local",
  };
}

const CLOCK_TTL_MS = 60_000;
let clockCache: { at: number; clock: Awaited<ReturnType<typeof fetchAlpacaClock>> } | null =
  null;

async function getClock() {
  if (clockCache && Date.now() - clockCache.at < CLOCK_TTL_MS) {
    return clockCache.clock;
  }
  const clock = isAlpacaConfigured() ? await fetchAlpacaClock() : null;
  clockCache = { at: Date.now(), clock };
  return clock;
}

/** Equity market status, Alpaca-first with a local fallback. */
export async function getEquityMarketStatus(): Promise<MarketStatus> {
  const clock = await getClock();

  if (clock) {
    const session: MarketSession = clock.isOpen ? "regular" : "closed";
    const nextChangeAt = clock.isOpen ? clock.nextClose : clock.nextOpen;
    return {
      session,
      isEquity: true,
      tradingAllowed: clock.isOpen,
      label: labelFor(session, nextChangeAt),
      nextChangeAt: nextChangeAt ? nextChangeAt.toISOString() : null,
      source: "alpaca",
    };
  }

  return localStatus();
}

/**
 * Status for a specific asset class. Crypto never closes, so it is always
 * tradable — equity market hours must not be applied to it (spec §12).
 */
export async function getMarketStatusFor(assetType: "stock" | "crypto"): Promise<MarketStatus> {
  if (assetType === "crypto") {
    return {
      session: "regular",
      isEquity: false,
      tradingAllowed: true,
      label: "Crypto · 24/7",
      nextChangeAt: null,
      source: "local",
    };
  }
  return getEquityMarketStatus();
}
