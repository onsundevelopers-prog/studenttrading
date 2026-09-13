import { createAdminClient } from "@/lib/supabase/admin";
import type { Asset, AssetType, PricePoint, Quote } from "@/lib/types";
import { numOrNull } from "@/lib/types";

import {
  fetchCompanyProfile,
  fetchQuote as fetchFinnhubQuote,
  getCryptoUniverse,
  isMarketDataConfigured,
  MarketDataError,
  searchEquities,
  type SymbolSearchHit,
} from "./finnhub";
import {
  fetchAlpacaBars,
  fetchAlpacaQuotes,
  isAlpacaConfigured,
} from "./alpaca";

/**
 * The only place in the application that talks to a market data provider.
 *
 * Every other module asks this service for a quote. That keeps the API key on
 * the server, keeps caching in one place, and means an upstream outage produces
 * one honest error message rather than a scattering of invented prices.
 */

/** How long a cached quote is considered current. */
export const QUOTE_TTL_SECONDS = 60;
/** Minimum gap between two price_history samples for the same asset. */
export const HISTORY_SAMPLE_SECONDS = 300;

export const MARKET_UNCONFIGURED_MESSAGE =
  "Market data is not configured. Set FINNHUB_API_KEY in your environment.";

export type ExtendedQuote = Quote & {
  bid: number | null;
  ask: number | null;
  volume: number | null;
};

/** Shape the quote pipeline normalises to, whichever provider supplied it. */
type FreshQuote = {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
  providerTime: Date | null;
  bid?: number | null;
  ask?: number | null;
  volume?: number | null;
};

/** Re-exported so callers only need one market-data import. */
export { isMarketDataConfigured };

export const MARKET_UNAVAILABLE_MESSAGE =
  "Market data is temporarily unavailable. Please try again shortly.";

export type QuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; reason: string };

type CachedPriceRow = {
  symbol: string;
  price: number | string;
  previous_close: number | string | null;
  change: number | string | null;
  change_percent: number | string | null;
  day_high: number | string | null;
  day_low: number | string | null;
  day_open: number | string | null;
  provider_time: string | null;
  fetched_at: string;
};

function messageOf(error: unknown): string {
  if (error instanceof MarketDataError) return error.message;
  return MARKET_UNAVAILABLE_MESSAGE;
}

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function ageSeconds(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 1000;
}

function rowToQuote(row: CachedPriceRow, stale: boolean): Quote {
  return {
    symbol: row.symbol,
    price: Number(row.price),
    change: numOrNull(row.change),
    changePercent: numOrNull(row.change_percent),
    previousClose: numOrNull(row.previous_close),
    dayHigh: numOrNull(row.day_high),
    dayLow: numOrNull(row.day_low),
    dayOpen: numOrNull(row.day_open),
    providerTime: row.provider_time,
    fetchedAt: row.fetched_at,
    stale,
  };
}

async function readCachedQuote(symbol: string): Promise<CachedPriceRow | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("price_cache")
    .select(
      "symbol, price, previous_close, change, change_percent, day_high, day_low, day_open, provider_time, fetched_at",
    )
    .eq("symbol", symbol)
    .maybeSingle();

  if (error) return null;
  return (data as CachedPriceRow | null) ?? null;
}

async function cacheQuote(quote: {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
  providerTime: Date | null;
}): Promise<void> {
  const db = createAdminClient();
  await db.from("price_cache").upsert(
    {
      symbol: quote.symbol,
      // Numeric columns: pass strings so no float rounding creeps in.
      price: quote.price.toString(),
      previous_close: quote.previousClose?.toString() ?? null,
      change: quote.change?.toString() ?? null,
      change_percent: quote.changePercent?.toString() ?? null,
      day_high: quote.dayHigh?.toString() ?? null,
      day_low: quote.dayLow?.toString() ?? null,
      day_open: quote.dayOpen?.toString() ?? null,
      provider_time: quote.providerTime?.toISOString() ?? null,
      fetched_at: new Date().toISOString(),
      last_error: null,
      error_at: null,
    },
    { onConflict: "symbol" },
  );
}

async function recordCacheError(symbol: string, message: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("price_cache")
    .update({ last_error: message, error_at: new Date().toISOString() })
    .eq("symbol", symbol);
}

// ---------------------------------------------------------------------------
// Historical OHLCV bars (spec §10) — real provider history, replacing the
// "sampled by this simulator" chart where the provider supports it.
// ---------------------------------------------------------------------------
export type HistoricalBar = {
  time: string; // ISO timestamp of the bar open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Real daily bars for a symbol, from Alpaca when configured. Returns an empty
 * array when the provider has no history — the UI falls back to the sampled
 * price_history series rather than inventing data.
 */
export async function getHistoricalBars(
  symbol: string,
  options: { days: number } = { days: 365 },
): Promise<HistoricalBar[]> {
  if (!isAlpacaConfigured()) return [];

  const start = new Date();
  start.setDate(start.getDate() - options.days);
  start.setHours(0, 0, 0, 0);

  try {
    const bars = await fetchAlpacaBars(symbol, { start, maxBars: options.days + 5 });
    return bars.map((bar: AlpacaBarShim) => ({
      time: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  } catch {
    // Historical data is a UI enhancement; a failure must not take down the
    // stock page. The sampled series still renders.
    return [];
  }
}

type AlpacaBarShim = { t: string; o: number; h: number; l: number; c: number; v: number };

// ---------------------------------------------------------------------------
// Price history
// ---------------------------------------------------------------------------
/**
 * Finnhub's free tier does not expose historical candles for either stocks or
 * crypto, so there is no way to back-fill a chart. Instead, every successful
 * quote fetch appends a sample (rate-limited to one per asset per five minutes),
 * and the chart is drawn from what has genuinely been observed. An asset with a
 * single sample honestly renders as a single point.
 */
async function maybeSampleHistory(
  symbol: string,
  price: number,
): Promise<void> {
  const db = createAdminClient();

  const { data: asset } = await db
    .from("assets")
    .select("id")
    .eq("symbol", symbol)
    .maybeSingle();

  if (!asset?.id) return; // not a known asset yet — nothing to attach a sample to

  const { data: latest } = await db
    .from("price_history")
    .select("captured_at")
    .eq("asset_id", asset.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.captured_at && ageSeconds(latest.captured_at) < HISTORY_SAMPLE_SECONDS) {
    return;
  }

  await db
    .from("price_history")
    .insert({ asset_id: asset.id, price: price.toString() });
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
export async function getQuote(
  symbol: string,
  options: { maxAgeSeconds?: number } = {},
): Promise<QuoteResult> {
  if (!isMarketDataConfigured()) {
    return { ok: false, reason: MARKET_UNCONFIGURED_MESSAGE };
  }

  const key = normalizeSymbol(symbol);
  if (!key) return { ok: false, reason: "No asset specified." };

  const maxAge = options.maxAgeSeconds ?? QUOTE_TTL_SECONDS;
  const cached = await readCachedQuote(key);

  if (cached && ageSeconds(cached.fetched_at) < maxAge) {
    return { ok: true, quote: rowToQuote(cached, false) };
  }

  try {
    // Alpaca first (real bid/ask feed), Finnhub fallback.
    let fresh: FreshQuote | null = null;
    if (isAlpacaConfigured()) {
      const alpaca = await fetchAlpacaQuotes([key]);
      const hit = alpaca.quotes.find((q) => q.symbol === key);
      if (hit) {
        // Daily change needs a previous close; Alpaca's latest-quote call does
        // not carry one, so pull it from the last cached row when present.
        const prevClose = cached?.previous_close != null ? Number(cached.previous_close) : null;
        fresh = {
          symbol: key,
          price: hit.price,
          change: prevClose != null ? hit.price - prevClose : null,
          changePercent:
            prevClose != null && prevClose > 0
              ? ((hit.price - prevClose) / prevClose) * 100
              : null,
          previousClose: prevClose,
          dayHigh: null,
          dayLow: null,
          dayOpen: null,
          providerTime: hit.providerTime,
          bid: hit.bid,
          ask: hit.ask,
          volume: hit.volume,
        };
      } else if (alpaca.unknown.includes(key)) {
        // Alpaca answered but does not know this symbol — fall through to
        // Finnhub before declaring it unknown.
      }
    }

    if (!fresh && isMarketDataConfigured()) {
      fresh = await fetchFinnhubQuote(key);
    }

    if (!fresh) {
      // The providers answered, but have no such instrument.
      if (cached) return { ok: true, quote: rowToQuote(cached, true) };
      return {
        ok: false,
        reason: `No market data is available for ${key}. Check the symbol and try again.`,
      };
    }

    await cacheQuote(fresh);
    await maybeSampleHistory(key, fresh.price);

    return {
      ok: true,
      quote: {
        symbol: fresh.symbol,
        price: fresh.price,
        change: fresh.change,
        changePercent: fresh.changePercent,
        previousClose: fresh.previousClose,
        dayHigh: fresh.dayHigh,
        dayLow: fresh.dayLow,
        dayOpen: fresh.dayOpen,
        providerTime: fresh.providerTime?.toISOString() ?? null,
        fetchedAt: new Date().toISOString(),
        stale: false,
      },
    };
  } catch (error) {
    // Serving a cached price with `stale: true` is honest; inventing one is not.
    if (cached) {
      await recordCacheError(key, messageOf(error));
      return { ok: true, quote: rowToQuote(cached, true) };
    }
    return { ok: false, reason: messageOf(error) };
  }
}

/** Runs `task` over `items` with a bounded number in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export type QuoteMap = {
  quotes: Map<string, Quote>;
  /** Symbols we could not price, with the reason. Surfaced in the UI. */
  failures: Map<string, string>;
};

/**
 * Fetches many quotes, reusing one cache read per symbol and staying inside the
 * provider's rate limit. Never throws: failures come back in `failures` so a
 * single bad symbol cannot blank out a whole dashboard.
 */
export async function getQuotes(symbols: string[]): Promise<QuoteMap> {
  const unique = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
  const quotes = new Map<string, Quote>();
  const failures = new Map<string, string>();

  if (unique.length === 0) return { quotes, failures };

  if (!isMarketDataConfigured()) {
    for (const symbol of unique) failures.set(symbol, MARKET_UNCONFIGURED_MESSAGE);
    return { quotes, failures };
  }

  const results = await mapLimit(unique, 4, async (symbol) => ({
    symbol,
    result: await getQuote(symbol),
  }));

  for (const { symbol, result } of results) {
    if (result.ok) quotes.set(symbol, result.quote);
    else failures.set(symbol, result.reason);
  }

  return { quotes, failures };
}

export async function getQuotesForAssets(assets: Asset[]): Promise<QuoteMap> {
  return getQuotes(assets.map((asset) => asset.symbol));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
export type SearchOutcome =
  | { ok: true; hits: SymbolSearchHit[] }
  | { ok: false; reason: string };

export async function searchMarket(query: string): Promise<SearchOutcome> {
  if (!isMarketDataConfigured()) {
    return { ok: false, reason: MARKET_UNCONFIGURED_MESSAGE };
  }

  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: true, hits: [] };

  const lowered = trimmed.toLowerCase();

  const [equities, crypto] = await Promise.allSettled([
    searchEquities(trimmed),
    getCryptoUniverse(),
  ]);

  if (equities.status === "rejected" && crypto.status === "rejected") {
    return {
      ok: false,
      reason:
        equities.reason instanceof MarketDataError
          ? equities.reason.message
          : MARKET_UNAVAILABLE_MESSAGE,
    };
  }

  const cryptoHits =
    crypto.status === "fulfilled"
      ? crypto.value
          .filter(
            (item) =>
              item.displaySymbol.toLowerCase().includes(lowered) ||
              item.name.toLowerCase().includes(lowered),
          )
          .slice(0, 8)
      : [];

  // Exact ticker matches float to the top: typing "AAPL" should not bury Apple
  // beneath "Apple Hospitality REIT".
  const equityHits = equities.status === "fulfilled" ? equities.value : [];
  const exact: SymbolSearchHit[] = [];
  const rest: SymbolSearchHit[] = [];
  for (const hit of equityHits) {
    if (
      hit.symbol.toUpperCase() === trimmed.toUpperCase() ||
      hit.displaySymbol.toUpperCase() === trimmed.toUpperCase()
    ) {
      exact.push(hit);
    } else {
      rest.push(hit);
    }
  }

  const merged = [...exact, ...cryptoHits, ...rest];
  const seen = new Set<string>();
  const hits: SymbolSearchHit[] = [];
  for (const hit of merged) {
    const key = `${hit.assetType}:${hit.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
    if (hits.length >= 20) break;
  }

  return { ok: true, hits };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
/**
 * Derives everything about a symbol from the symbol itself, so no cosmetic asset
 * metadata (name, display label, asset class) ever comes from the browser.
 *
 * Finnhub crypto symbols are namespaced — `BINANCE:BTCUSDT` — which is also the
 * signal for the asset class.
 */
function describeSymbol(symbol: string): {
  assetType: AssetType;
  displaySymbol: string;
  exchange: string | null;
} {
  if (symbol.includes(":")) {
    const [exchange, pair] = symbol.split(":", 2);
    const displaySymbol = pair.endsWith("USDT")
      ? `${pair.slice(0, -4)}/USDT`
      : pair;
    return { assetType: "crypto", displaySymbol, exchange };
  }
  return { assetType: "stock", displaySymbol: symbol, exchange: null };
}

/**
 * Ensures a symbol exists in the `assets` table so it can be traded and stored
 * against holdings. Names come from the provider, never from a guess.
 */
export async function ensureAsset(
  rawSymbol: string,
): Promise<{ ok: true; assetId: string } | { ok: false; reason: string }> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol || symbol.length > 60) {
    return { ok: false, reason: "That is not a valid symbol." };
  }

  const db = createAdminClient();

  const { data: existing } = await db
    .from("assets")
    .select("id")
    .eq("symbol", symbol)
    .maybeSingle();

  if (existing?.id) return { ok: true, assetId: existing.id };

  const derived = describeSymbol(symbol);
  let name = derived.displaySymbol;
  let exchange = derived.exchange;

  if (derived.assetType === "stock") {
    const profile = await fetchCompanyProfile(symbol);
    if (profile?.name) name = profile.name;
    if (profile?.exchange) exchange = profile.exchange;
  } else {
    name = derived.displaySymbol.replace("/", " / ");
  }

  const { data, error } = await db.rpc("upsert_asset", {
    p_symbol: symbol,
    p_display_symbol: derived.displaySymbol,
    p_name: name,
    p_asset_type: derived.assetType,
    p_exchange: exchange,
    p_currency: "USD",
  });

  if (error || !data) {
    return {
      ok: false,
      reason: `Could not register ${symbol} as a tradeable asset.`,
    };
  }

  return { ok: true, assetId: String(data) };
}

export async function getAssetBySymbol(symbol: string): Promise<Asset | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("assets")
    .select("id, symbol, display_symbol, name, asset_type, exchange, currency")
    .eq("symbol", normalizeSymbol(symbol))
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    symbol: data.symbol,
    displaySymbol: data.display_symbol,
    name: data.name,
    assetType: data.asset_type as AssetType,
    exchange: data.exchange,
    currency: data.currency,
  };
}

export async function listTradeableAssets(): Promise<Asset[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("assets")
    .select("id, symbol, display_symbol, name, asset_type, exchange, currency")
    .eq("is_active", true)
    .order("asset_type", { ascending: true })
    .order("symbol", { ascending: true })
    .limit(500);

  return (data ?? []).map((row) => ({
    id: row.id,
    symbol: row.symbol,
    displaySymbol: row.display_symbol,
    name: row.name,
    assetType: row.asset_type as AssetType,
    exchange: row.exchange,
    currency: row.currency,
  }));
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export async function getPriceHistory(
  assetId: string,
  limit = 400,
): Promise<PricePoint[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("price_history")
    .select("captured_at, price")
    .eq("asset_id", assetId)
    .order("captured_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => ({
    capturedAt: row.captured_at as string,
    price: Number(row.price),
  }));
}

/**
 * Symbols the simulator actually needs prices for: everything held, plus
 * everything anybody is watching.
 *
 * Deliberately NOT the whole asset universe. Prices come from a 60 test/minute
 * free tier, and a scheduled job that tries to sample hundreds of symbols would
 * both exhaust the quota and blow past a serverless function's time limit.
 */
export async function symbolsInUse(): Promise<string[]> {
  const db = createAdminClient();
  const symbols = new Set<string>();

  const { data: holdings } = await db
    .from("holdings")
    .select("assets ( symbol )")
    .gt("quantity", 0)
    .limit(1000);

  for (const row of holdings ?? []) {
    const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
    if (asset?.symbol) symbols.add(String(asset.symbol));
  }

  const { data: watched } = await db
    .from("watchlist_items")
    .select("assets ( symbol )")
    .limit(1000);

  for (const row of watched ?? []) {
    const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
    if (asset?.symbol) symbols.add(String(asset.symbol));
  }

  return Array.from(symbols);
}

/**
 * Samples a batch of assets and records one portfolio snapshot per active
 * student. Called by the teacher's "refresh market data" action and by the
 * scheduled cron endpoint, and it is what fills in both charts over time.
 */
export async function sampleMarketAndSnapshot(options: {
  symbols?: string[];
} = {}): Promise<{ sampled: number; failed: number; snapshotted: number }> {
  const db = createAdminClient();

  const symbols = options.symbols ?? (await symbolsInUse());

  const { quotes, failures } = await getQuotes(symbols);

  const { data: snapshotted, error } = await db.rpc("capture_snapshots", {
    p_classroom_id: null,
    p_student_id: null,
  });

  return {
    sampled: quotes.size,
    failed: failures.size,
    snapshotted: error ? 0 : Number(snapshotted ?? 0),
  };
}
