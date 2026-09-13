import { hasAlpacaKeys, serverEnv } from "@/lib/env";

/**
 * Thin server-only wrapper around Alpaca's Market Data REST API (v2) and
 * Clock/Calendar endpoints.
 *
 * Architecture rule (spec §16): Alpaca is the source of REAL MARKET DATA only.
 * It is never the source of truth for student balances, and students never get
 * an Alpaca account. Everything here is called exclusively from server modules.
 *
 * Care points, mirroring the Finnhub wrapper:
 *  - The secret key travels in headers, so it can never appear in a URL, error
 *    message, or log line. Errors carry the endpoint path only.
 *  - A process-wide rate limiter keeps bursts under the 200 req/min free tier.
 *  - Timeout/rate-limit/HTTP failures throw AlpacaError with a student-safe
 *    message; callers decide how to present it.
 */

const DATA_BASE_URL = "https://data.alpaca.markets/v2";
const CRYPTO_DATA_BASE_URL = "https://data.alpaca.markets/v1beta3/crypto/us";
const CLOCK_BASE_URL = "https://api.alpaca.markets/v2";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUESTS_PER_MINUTE = 150; // headroom under 200/min

export class AlpacaError extends Error {
  readonly status: number | null;
  readonly rateLimited: boolean;

  constructor(message: string, status: number | null = null) {
    // Message deliberately never contains the request URL — headers hold the key.
    super(message);
    this.name = "AlpacaError";
    this.status = status;
    this.rateLimited = status === 429;
  }
}

export function isAlpacaConfigured(): boolean {
  return hasAlpacaKeys();
}

// ---------------------------------------------------------------------------
// Rate limiting — same shape as the Finnhub limiter
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

function authHeaders(): HeadersInit {
  return {
    "APCA-API-KEY-ID": serverEnv.alpacaApiKey,
    "APCA-API-SECRET-KEY": serverEnv.alpacaSecretKey,
    Accept: "application/json",
  };
}

async function request<T>(
  url: URL,
  scope: "data" | "trading",
): Promise<T> {
  if (!isAlpacaConfigured()) {
    throw new AlpacaError(
      "Alpaca market data is not configured. Set ALPACA_API_KEY and ALPACA_SECRET_KEY.",
    );
  }

  await waitForSlot();

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
      headers: authHeaders(),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    throw new AlpacaError(
      aborted
        ? "The market data provider timed out."
        : "Could not reach the market data provider.",
    );
  }

  if (response.status === 429) {
    throw new AlpacaError(
      "Market data rate limit reached. Try again in a moment.",
      429,
    );
  }

  if (response.status === 403 || response.status === 401) {
    throw new AlpacaError(
      `Market data access was refused (${scope === "data" ? "data" : "clock"} endpoint). Check the Alpaca credentials.`,
      response.status,
    );
  }

  if (!response.ok) {
    throw new AlpacaError(
      `Market data provider returned status ${response.status}.`,
      response.status,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new AlpacaError("The market data provider returned malformed data.");
  }
}

function dataUrl(path: string, params: Record<string, string> = {}): URL {
  const url = new URL(`${DATA_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Symbol mapping — internal symbol ↔ Alpaca feed symbol
// ---------------------------------------------------------------------------
/**
 * The simulator's own symbols are provider-neutral: `AAPL` for stocks and
 * `BINANCE:BTCUSDT` for crypto. Alpaca's crypto feed uses bare `BTC/USD`-style
 * pairs, so the two are mapped here — nowhere near a client.
 */
export function toAlpacaSymbol(symbol: string): string | null {
  if (symbol.includes(":")) {
    const [, pair] = symbol.split(":", 2);
    // BINANCE:BTCUSDT -> BTC/USD. Alpaca crypto quotes are USD-quoted.
    if (pair.endsWith("USDT")) return `${pair.slice(0, -4)}/USD`;
    if (pair.endsWith("USD")) return `${pair.slice(0, -3)}/USD`;
    return null;
  }
  return symbol;
}

export function fromAlpacaSymbol(alpacaSymbol: string): string {
  if (alpacaSymbol.includes("/")) {
    return `BINANCE:${alpacaSymbol.replace("/", "")}USDT`;
  }
  return alpacaSymbol;
}

// ---------------------------------------------------------------------------
// Latest quotes — supports batching, which keeps a whole dashboard inside a
// single API call.
// ---------------------------------------------------------------------------
type RawTrade = {
  t?: string;
  /** Last trade price — used as a fallback when a quote has no bid/ask. */
  p?: number | string;
  s?: number | string;
  /** Best bid / ask prices on the latest quote (v2 /stocks/quotes/latest). */
  bp?: number | string;
  ap?: number | string;
};

type RawLatestTrades = { [symbol: string]: RawTrade | null };

type RawLatestQuotes = { [symbol: string]: RawTrade | null };
type RawLatestBars = {
  [symbol: string]: { t?: string; c?: number | string } | null;
};

export type AlpacaQuote = {
  symbol: string; // internal symbol
  price: number;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  providerTime: Date | null;
};

/**
 * Latest quotes for many symbols in one request. IEX feed is the free tier; it
 * covers US equities and Alpaca's crypto feed alike.
 *
 * For equities we prefer the latest *quote*'s mid-price shape: bid/ask where
 * available, falling back to the latest bar close (IEX bars lag but always
 * exist). Crypto has no bid/ask on the free feed — the bar close is the price.
 */
export async function fetchAlpacaQuotes(
  symbols: string[],
): Promise<{ quotes: AlpacaQuote[]; unknown: string[] }> {
  const quotes: AlpacaQuote[] = [];
  const unknown: string[] = [];
  if (symbols.length === 0) return { quotes, unknown };

  const byAlpaca = new Map<string, string>(); // alpaca symbol -> internal
  for (const symbol of symbols) {
    const mapped = toAlpacaSymbol(symbol);
    if (mapped) byAlpaca.set(mapped, symbol);
  }
  if (byAlpaca.size === 0) return { quotes, unknown: symbols };

  const equities: string[] = [];
  const crypto: string[] = [];
  for (const alpacaSymbol of byAlpaca.keys()) {
    if (alpacaSymbol.includes("/")) crypto.push(alpacaSymbol);
    else equities.push(alpacaSymbol);
  }

  const internal = (alpacaSymbol: string) => byAlpaca.get(alpacaSymbol)!;

  // --- equities: latest quotes + latest trades in two batched calls ---
  if (equities.length > 0) {
    const [quoteRes, tradeRes] = await Promise.allSettled([
      request<RawLatestQuotes>(
        dataUrl("/stocks/quotes/latest", { symbols: equities.join(","), feed: "iex" }),
        "data",
      ),
      request<RawLatestTrades>(
        dataUrl("/stocks/trades/latest", { symbols: equities.join(","), feed: "iex" }),
        "data",
      ),
    ]);

    const quoteMap =
      (quoteRes.status === "fulfilled"
        ? (quoteRes.value.quotes ?? {})
        : {}) as RawLatestQuotes;
    const tradeMap =
      (tradeRes.status === "fulfilled"
        ? (tradeRes.value.trades ?? {})
        : {}) as RawLatestTrades;

    for (const alpacaSymbol of equities) {
      const q = quoteMap[alpacaSymbol];
      const lastTrade = tradeMap[alpacaSymbol];
      const bid = q?.bp != null ? Number(q.bp) : null;
      const ask = q?.ap != null ? Number(q.ap) : null;
      const last = lastTrade?.p != null ? Number(lastTrade.p) : null;

      // Mid when both sides are live, otherwise the last trade. The IEX feed
      // quotes only IEX-printed activity, so single-sided books are common.
      let price: number | null = null;
      if (bid != null && ask != null && bid > 0 && ask > 0) {
        price = (bid + ask) / 2;
      } else if (last != null && last > 0) {
        price = last;
      }

      if (price == null || !Number.isFinite(price) || price <= 0) {
        unknown.push(internal(alpacaSymbol));
        continue;
      }

      quotes.push({
        symbol: internal(alpacaSymbol),
        price,
        bid,
        ask,
        volume: null, // bar volume needs /v2/stocks/bars; fetched on demand
        providerTime: q?.t
          ? new Date(q.t)
          : lastTrade?.t
            ? new Date(lastTrade.t)
            : null,
      });
    }
  }

  // --- crypto: latest bars (v1beta3; no bid/ask on the free feed) ---
  if (crypto.length > 0) {
    try {
      const cryptoUrl = new URL(
        `${CRYPTO_DATA_BASE_URL}/latest/bars?symbols=${crypto.join(",")}`,
      );
      const barRes = await request<RawLatestBars>(cryptoUrl, "data");
      const barMap = (barRes.bars ?? {}) as RawLatestBars;
      for (const alpacaSymbol of crypto) {
        const bar = barMap[alpacaSymbol];
        const close = bar?.c != null ? Number(bar.c) : null;
        if (close == null || !Number.isFinite(close) || close <= 0) {
          unknown.push(internal(alpacaSymbol));
          continue;
        }
        quotes.push({
          symbol: internal(alpacaSymbol),
          price: close,
          bid: null,
          ask: null,
          volume: null,
          providerTime: bar?.t ? new Date(bar.t) : null,
        });
      }
    } catch {
      for (const alpacaSymbol of crypto) unknown.push(internal(alpacaSymbol));
    }
  }

  return { quotes, unknown };
}

// ---------------------------------------------------------------------------
// Historical bars — real OHLCV for the stock detail chart
// ---------------------------------------------------------------------------
export type AlpacaBar = {
  t: string; // bar start time, ISO
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // volume
};

type RawBar = {
  t: string;
  o: number | string;
  h: number | string;
  l: number | string;
  c: number | string;
  v: number | string;
};

type RawBarsResponse = {
  /** v2 returns a per-symbol map; v1beta3 crypto returns a flat array. */
  bars?: Record<string, RawBar[]> | RawBar[];
  next_page_token?: string | null;
};

/**
 * Daily (or intraday) bars for one symbol. `timeframe` follows Alpaca's
 * syntax: 1Day, 1Hour, 15Min, etc. Pages through up to `maxBars` results.
 */
export async function fetchAlpacaBars(
  symbol: string,
  options: { timeframe?: string; start: Date; end?: Date; maxBars?: number } ,
): Promise<AlpacaBar[]> {
  const mapped = toAlpacaSymbol(symbol);
  if (!mapped) return [];

  const timeframe = options.timeframe ?? "1Day";
  const maxBars = options.maxBars ?? 500;
  const isCrypto = mapped.includes("/");

  const params: Record<string, string> = {
    symbols: mapped,
    timeframe,
    start: options.start.toISOString(),
    limit: "10000",
  };
  if (options.end) params.end = options.end.toISOString();
  if (!isCrypto) params.feed = "iex";

  // Crypto history lives on v1beta3 with a different path shape.
  const url = isCrypto
    ? new URL(
        `${CRYPTO_DATA_BASE_URL}/bars?${new URLSearchParams(params).toString()}`,
      )
    : dataUrl("/stocks/bars", params);
  const bars: AlpacaBar[] = [];

  // Page through with next_page_token, bounded by maxBars.
  for (let page = 0; page < 6 && bars.length < maxBars; page += 1) {
    const raw = await request<RawBarsResponse>(url, "data");
    // v2 shapes bars as { AAPL: [...] }, v1beta3 crypto as a flat array.
    const pageBars: RawBar[] = Array.isArray(raw.bars)
      ? raw.bars
      : ((raw.bars?.[mapped] as RawBar[] | undefined) ?? []);
    for (const bar of pageBars) {
      bars.push({
        t: bar.t,
        o: Number(bar.o),
        h: Number(bar.h),
        l: Number(bar.l),
        c: Number(bar.c),
        v: Number(bar.v),
      });
      if (bars.length >= maxBars) break;
    }
    if (!raw.next_page_token) break;
    url.searchParams.set("page_token", raw.next_page_token);
  }

  return bars;
}

// ---------------------------------------------------------------------------
// Corporate actions — real split/dividend records (spec §11)
// ---------------------------------------------------------------------------
export type AlpacaCorporateAction = {
  date: string;
  type: string; // e.g. "split", "dividend"
  symbol: string;
  rate: number | null; // split ratio numerator/denominator as decimal
  amount: number | null; // cash dividend per share
};

type RawCorporateActionsResponse = {
  corporate_actions?: Array<{
    ca_date?: string;
    ca_type?: string;
    symbol?: string;
    rate?: number | string;
    amount?: number | string;
  }>;
};

/**
 * Splits and dividends for a symbol since a date. The trading engine applies
 * these server-side against positions (never in the frontend); this fetch is
 * the data source for that job.
 */
export async function fetchAlpacaCorporateActions(
  symbol: string,
  since: Date,
): Promise<AlpacaCorporateAction[]> {
  const mapped = toAlpacaSymbol(symbol);
  if (!mapped || mapped.includes("/")) return []; // crypto has no corporate actions

  const raw = await request<RawCorporateActionsResponse>(
    dataUrl("/corporate-actions", {
      symbols: mapped,
      start: since.toISOString().slice(0, 10),
      types: "split,dividend",
    }),
    "data",
  );

  return (raw.corporate_actions ?? [])
    .filter((action) => action.symbol === mapped)
    .map((action) => ({
      date: String(action.ca_date ?? ""),
      type: String(action.ca_type ?? ""),
      symbol: String(action.symbol ?? mapped),
      rate: action.rate != null ? Number(action.rate) : null,
      amount: action.amount != null ? Number(action.amount) : null,
    }));
}

// ---------------------------------------------------------------------------
// Clock — real market status from Alpaca (spec §3)
// ---------------------------------------------------------------------------
export type AlpacaClock = {
  /** Alpaca's own judgment: is the regular session open right now. */
  isOpen: boolean;
  nextOpen: Date | null;
  nextClose: Date | null;
  timestamp: Date;
};

type RawClock = {
  timestamp?: string;
  is_open?: boolean;
  next_open?: string;
  next_close?: string;
};

/**
 * Alpaca's clock covers regular US equity hours and holidays. Pre/post market
 * states are derived from timestamps here, and the market-status service
 * combines this with its own session logic.
 */
export async function fetchAlpacaClock(): Promise<AlpacaClock | null> {
  const url = new URL(`${CLOCK_BASE_URL}/clock`);
  try {
    const raw = await request<RawClock>(url, "trading");
    return {
      isOpen: Boolean(raw.is_open),
      nextOpen: raw.next_open ? new Date(raw.next_open) : null,
      nextClose: raw.next_close ? new Date(raw.next_close) : null,
      timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
    };
  } catch {
    // The clock endpoint lives on the trading API; a paper account without it
    // should degrade to local session logic rather than break the app.
    return null;
  }
}
