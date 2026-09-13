import { hasFinnhubKey, serverEnv } from "@/lib/env";

/**
 * Thin wrapper around the Finnhub REST API.
 *
 * Two things this module is careful about:
 *  - The API key goes in the query string, so it must never appear in an error
 *    message, a log line, or a thrown stack. Errors carry the path only.
 *  - Free-tier limits matter here (60 requests/minute), so a process-wide
 *    limiter smooths bursts instead of letting a class-sized dashboard trip a
 *    429.
 */

const BASE_URL = "https://finnhub.io/api/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUESTS_PER_MINUTE = 50; // headroom under the 60/min free tier

export class MarketDataError extends Error {
  readonly status: number | null;
  readonly rateLimited: boolean;

  constructor(message: string, status: number | null = null) {
    // Message deliberately never contains the request URL — it holds the key.
    super(message);
    this.name = "MarketDataError";
    this.status = status;
    this.rateLimited = status === 429;
  }
}

export function isMarketDataConfigured(): boolean {
  return hasFinnhubKey();
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const callTimestamps: number[] = [];

async function waitForSlot(): Promise<void> {
  const windowMs = 60_000;
  for (;;) {
    const now = Date.now();
    while (callTimestamps.length > 0 && now - callTimestamps[0] > windowMs) {
      callTimestamps.shift();
    }
    if (callTimestamps.length < MAX_REQUESTS_PER_MINUTE) {
      callTimestamps.push(now);
      return;
    }
    const waitMs = windowMs - (now - callTimestamps[0]) + 25;
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 25)));
  }
}

async function request<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  if (!isMarketDataConfigured()) {
    throw new MarketDataError(
      "Market data is not configured. Set FINNHUB_API_KEY in your environment.",
    );
  }

  await waitForSlot();

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("token", serverEnv.finnhubApiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    throw new MarketDataError(
      aborted
        ? "Our market data source timed out."
        : "We couldn't reach our market data source.",
    );
  }

  if (response.status === 429) {
    throw new MarketDataError(
      "Market data rate limit reached. Try again in a moment.",
      429,
    );
  }

  if (!response.ok) {
    throw new MarketDataError(
      `Market data provider returned status ${response.status}.`,
      response.status,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new MarketDataError(
      "Our market data source returned something we couldn't read.",
    );
  }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
type RawQuote = {
  c?: number; // current
  d?: number | null; // change
  dp?: number | null; // change percent
  h?: number; // day high
  l?: number; // day low
  o?: number; // day open
  pc?: number; // previous close
  t?: number; // provider timestamp (epoch seconds)
};

export type NormalizedQuote = {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
  providerTime: Date | null;
};

/**
 * Works for equities and crypto alike — Finnhub's /quote accepts both `AAPL`
 * and `BINANCE:BTCUSDT`.
 *
 * Returns null when the symbol is unknown: Finnhub answers unknown symbols with
 * a body of all zeros rather than an error, and reporting a $0.00 price would be
 * worse than reporting nothing.
 */
export async function fetchQuote(symbol: string): Promise<NormalizedQuote | null> {
  const raw = await request<RawQuote>("/quote", { symbol });
  const price = Number(raw.c ?? 0);
  const providerTime = Number(raw.t ?? 0);

  if (!Number.isFinite(price) || price <= 0) return null;
  // A zero timestamp together with a zero previous close is the "no such
  // instrument" shape.
  if (providerTime === 0 && Number(raw.pc ?? 0) === 0) return null;

  return {
    symbol,
    price,
    change: Number.isFinite(Number(raw.d)) ? Number(raw.d) : null,
    changePercent: Number.isFinite(Number(raw.dp)) ? Number(raw.dp) : null,
    previousClose: Number(raw.pc) > 0 ? Number(raw.pc) : null,
    dayHigh: Number(raw.h) > 0 ? Number(raw.h) : null,
    dayLow: Number(raw.l) > 0 ? Number(raw.l) : null,
    dayOpen: Number(raw.o) > 0 ? Number(raw.o) : null,
    providerTime: providerTime > 0 ? new Date(providerTime * 1000) : null,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
type RawSearchResponse = {
  count?: number;
  result?: Array<{
    description?: string;
    displaySymbol?: string;
    symbol?: string;
    type?: string;
  }>;
};

export type SymbolSearchHit = {
  symbol: string;
  displaySymbol: string;
  name: string;
  assetType: "stock" | "crypto";
  exchange: string | null;
};

/**
 * Equities only. `exchange=US` keeps the results to US listings, which removes
 * the foreign-listing noise (SOL.AX, BTC.PA) that the unfiltered endpoint
 * returns for classroom-relevant queries.
 */
export async function searchEquities(query: string): Promise<SymbolSearchHit[]> {
  const raw = await request<RawSearchResponse>("/search", {
    q: query,
    exchange: "US",
  });

  return (raw.result ?? [])
    .filter((hit) => Boolean(hit.symbol) && Boolean(hit.displaySymbol))
    .map((hit) => ({
      symbol: String(hit.symbol),
      displaySymbol: String(hit.displaySymbol),
      name: String(hit.description ?? ""),
      assetType: "stock" as const,
      exchange: "US",
    }));
}

type RawCryptoSymbol = {
  description?: string;
  displaySymbol?: string;
  symbol?: string;
};

let cryptoListCache: { at: number; items: SymbolSearchHit[] } | null = null;
const CRYPTO_LIST_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Crypto instruments are not covered by /search, so the Binance symbol list is
 * fetched once and filtered locally. Restricted to USDT pairs, which is the
 * subset a classroom would recognise.
 */
export async function getCryptoUniverse(): Promise<SymbolSearchHit[]> {
  if (cryptoListCache && Date.now() - cryptoListCache.at < CRYPTO_LIST_TTL_MS) {
    return cryptoListCache.items;
  }

  const raw = await request<RawCryptoSymbol[]>("/crypto/symbol", {
    exchange: "binance",
  });

  const items: SymbolSearchHit[] = [];
  for (const entry of raw ?? []) {
    const symbol = String(entry.symbol ?? "");
    const display = String(entry.displaySymbol ?? "");
    if (!symbol.startsWith("BINANCE:") || !display.endsWith("/USDT")) continue;

    // Skip leveraged tokens and oddities that would confuse a student.
    const base = display.slice(0, -5);
    if (!/^[A-Z0-9]{2,10}$/.test(base)) continue;
    if (base.endsWith("UP") || base.endsWith("DOWN") || base.endsWith("BULL")) continue;

    items.push({
      symbol,
      displaySymbol: display,
      name: `${base} / USDT`,
      assetType: "crypto",
      exchange: "BINANCE",
    });
  }

  cryptoListCache = { at: Date.now(), items };
  return items;
}

export type CompanyProfile = {
  name: string;
  exchange: string | null;
  currency: string | null;
};

/** Used to give a newly discovered symbol a real name instead of a placeholder. */
export async function fetchCompanyProfile(
  symbol: string,
): Promise<CompanyProfile | null> {
  try {
    const raw = await request<{ name?: string; exchange?: string; currency?: string }>(
      "/stock/profile2",
      { symbol },
    );
    if (!raw?.name) return null;
    return {
      name: raw.name,
      exchange: raw.exchange ?? null,
      currency: raw.currency ?? null,
    };
  } catch {
    return null;
  }
}
