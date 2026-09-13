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
  fetchAlpacaSnapshots,
  isAlpacaConfigured,
  type AlpacaSnapshot,
} from "./alpaca";
import { type ChartRange } from "./ranges";
import { INDEX_ETFS, OVERVIEW_SYMBOLS } from "./universe";

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

/**
 * Shown to students when no market data provider is configured. It deliberately
 * avoids naming environment variables: a student cannot act on that, and it is
 * the operator, not the student, who has to fix it.
 */
export const MARKET_UNCONFIGURED_MESSAGE =
  "Live market data isn't set up yet, so prices can't be shown. Ask your teacher to finish setting up the market data source.";

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
  "Live market data is temporarily unavailable. Please try again shortly.";

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

/**
 * Turns a provider snapshot into the internal quote shape. Every field the
 * spec asks for (previous close, open, high, low, volume) is real provider data
 * — nothing here is derived from a guess.
 */
function snapshotToFreshQuote(snapshot: AlpacaSnapshot): FreshQuote {
  const previousClose = snapshot.previousClose;
  return {
    symbol: snapshot.symbol,
    price: snapshot.price,
    change: previousClose !== null ? snapshot.price - previousClose : null,
    changePercent:
      previousClose !== null && previousClose > 0
        ? ((snapshot.price - previousClose) / previousClose) * 100
        : null,
    previousClose,
    dayHigh: snapshot.dayHigh,
    dayLow: snapshot.dayLow,
    dayOpen: snapshot.dayOpen,
    providerTime: snapshot.providerTime,
    bid: snapshot.bid,
    ask: snapshot.ask,
    volume: snapshot.volume,
  };
}

function freshQuoteToQuote(fresh: FreshQuote): Quote {
  return {
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
  };
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

/** One query for many cached quotes — used by the batched dashboard paths. */
async function readCachedQuotes(
  symbols: string[],
): Promise<Map<string, CachedPriceRow>> {
  const map = new Map<string, CachedPriceRow>();
  if (symbols.length === 0) return map;

  const db = createAdminClient();
  const { data, error } = await db
    .from("price_cache")
    .select(
      "symbol, price, previous_close, change, change_percent, day_high, day_low, day_open, provider_time, fetched_at",
    )
    .in("symbol", symbols);

  if (error) return map;
  for (const row of (data ?? []) as CachedPriceRow[]) map.set(row.symbol, row);
  return map;
}

type CacheableQuote = {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
  providerTime: Date | null;
};

function cacheRow(quote: CacheableQuote) {
  return {
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
  };
}

/** One upsert for a whole batch — a forty-row dashboard writes one statement. */
async function cacheQuotes(quotes: CacheableQuote[]): Promise<void> {
  if (quotes.length === 0) return;
  const db = createAdminClient();
  await db
    .from("price_cache")
    .upsert(quotes.map(cacheRow), { onConflict: "symbol" });
}

async function cacheQuote(quote: CacheableQuote): Promise<void> {
  await cacheQuotes([quote]);
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

type AlpacaBarShim = { t: string; o: number; h: number; l: number; c: number; v: number };

function toHistoricalBar(bar: AlpacaBarShim): HistoricalBar {
  return {
    time: bar.t,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  };
}

// ---------------------------------------------------------------------------
// Chart ranges (the range list itself lives in ./ranges, which is client-safe)
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
/** Oldest history the free IEX feed actually serves, so MAX is bounded. */
const MAX_HISTORY_START_MS = Date.UTC(2016, 0, 1);

type RangeSpec = {
  timeframe: string;
  sinceMs: number;
  maxBars: number;
  /**
   * Keep only the most recent N trading sessions.
   *
   * A trailing-window fetch is the only way to ask a provider for "the last
   * day", but a window that happens to fall on a weekend, a holiday or before
   * the open contains no bars at all. Trimming to the latest sessions is what
   * makes 1D mean "the most recent session" — which is what a terminal shows and
   * what a student expects on a Saturday.
   */
  sessions?: number;
};

const easternDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The trading date a bar belongs to, in exchange time. */
function easternDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : easternDateFormatter.format(parsed);
}

function trimToRecentSessions(
  bars: HistoricalBar[],
  sessions: number,
): HistoricalBar[] {
  if (bars.length === 0) return bars;
  const dates = Array.from(new Set(bars.map((bar) => easternDate(bar.time)))).sort();
  const keep = new Set(dates.slice(-sessions));
  return bars.filter((bar) => keep.has(easternDate(bar.time)));
}

/**
 * Which provider timeframe each range is drawn from. Intraday is used only
 * where the extra resolution is meaningful, and daily/weekly bars keep the long
 * ranges light enough to render and cheap enough to stay inside the rate limit.
 */
function rangeSpec(range: ChartRange, assetType: AssetType): RangeSpec {
  switch (range) {
    case "1D":
      // Request a week so a weekend or holiday cannot empty the chart, then keep
      // the most recent session.
      return { timeframe: "5Min", sinceMs: 7 * DAY_MS, maxBars: 900, sessions: 1 };
    case "5D":
      return { timeframe: "15Min", sinceMs: 12 * DAY_MS, maxBars: 900, sessions: 5 };
    case "1M":
      // Crypto trades around the clock, so a month of hourly bars is 700+ points
      // of noise; daily bars read far better.
      return assetType === "crypto"
        ? { timeframe: "1Day", sinceMs: 30 * DAY_MS, maxBars: 40 }
        : { timeframe: "1Hour", sinceMs: 30 * DAY_MS, maxBars: 800 };
    case "3M":
      return { timeframe: "1Day", sinceMs: 90 * DAY_MS, maxBars: 100 };
    case "6M":
      return { timeframe: "1Day", sinceMs: 180 * DAY_MS, maxBars: 200 };
    case "1Y":
      return { timeframe: "1Day", sinceMs: 365 * DAY_MS, maxBars: 300 };
    case "5Y":
      return { timeframe: "1Week", sinceMs: 5 * 365 * DAY_MS, maxBars: 300 };
    case "MAX":
      return { timeframe: "1Week", sinceMs: 0, maxBars: 700 };
  }
}

/**
 * Bars are cached in process for a short window, so switching range or two
 * students opening the same symbol is not two provider calls. The key carries
 * the range because the range decides the timeframe.
 */
const barCache = new Map<string, { at: number; bars: HistoricalBar[] }>();
const BAR_CACHE_MAX_ENTRIES = 300;

function barCacheTtl(range: ChartRange): number {
  return range === "1D" || range === "5D" ? 60_000 : 5 * 60_000;
}

/**
 * Real OHLCV bars for one range, straight from the provider. Returns an empty
 * array when there is no history — the caller falls back to the sampled
 * `price_history` series rather than inventing candles.
 */
export async function getChartBars(
  symbol: string,
  range: ChartRange,
  assetType: AssetType,
): Promise<HistoricalBar[]> {
  if (!isAlpacaConfigured()) return [];

  const key = normalizeSymbol(symbol);
  if (!key) return [];

  const cacheKey = `${key}:${range}`;
  const hit = barCache.get(cacheKey);
  if (hit && Date.now() - hit.at < barCacheTtl(range)) return hit.bars;

  const spec = rangeSpec(range, assetType);
  const start =
    spec.sinceMs === 0
      ? new Date(MAX_HISTORY_START_MS)
      : new Date(Date.now() - spec.sinceMs);

  try {
    const bars = await fetchAlpacaBars(key, {
      timeframe: spec.timeframe,
      start,
      maxBars: spec.maxBars,
    });
    const all = bars.map(toHistoricalBar);
    const mapped = spec.sessions
      ? trimToRecentSessions(all, spec.sessions)
      : all;

    // Successful responses are cached, including a genuinely empty one, so an
    // unknown symbol cannot hammer the provider either.
    if (barCache.size >= BAR_CACHE_MAX_ENTRIES) barCache.clear();
    barCache.set(cacheKey, { at: Date.now(), bars: mapped });
    return mapped;
  } catch {
    // A provider failure is deliberately not cached — the next render should
    // retry instead of pinning the chart empty for the whole TTL. A previous
    // good series is better than a blank panel.
    return hit?.bars ?? [];
  }
}

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
/**
 * Records at most one price sample per asset per `HISTORY_SAMPLE_SECONDS` for a
 * whole batch, in three queries rather than two per symbol.
 *
 * This is what fills the market page's sparklines and the long-range fallback
 * series over time. Batching it matters: the per-symbol version would issue
 * ~50 statements for one screen.
 */
async function sampleHistoryBatch(prices: Map<string, number>): Promise<void> {
  if (prices.size === 0) return;

  const db = createAdminClient();
  const { data: assets } = await db
    .from("assets")
    .select("id, symbol")
    .in("symbol", Array.from(prices.keys()));

  if (!assets || assets.length === 0) return;

  const idBySymbol = new Map(
    assets.map((row) => [String(row.symbol), String(row.id)]),
  );
  const ids = Array.from(idBySymbol.values());

  const since = new Date(Date.now() - HISTORY_SAMPLE_SECONDS * 1000).toISOString();
  const { data: recent } = await db
    .from("price_history")
    .select("asset_id")
    .in("asset_id", ids)
    .gte("captured_at", since)
    .limit(5000);

  const alreadySampled = new Set((recent ?? []).map((row) => String(row.asset_id)));

  const rows: Array<{ asset_id: string; price: string }> = [];
  for (const [symbol, price] of prices) {
    const assetId = idBySymbol.get(symbol);
    if (!assetId || alreadySampled.has(assetId)) continue;
    rows.push({ asset_id: assetId, price: price.toString() });
  }

  if (rows.length === 0) return;
  await db.from("price_history").insert(rows);
}

export async function getQuote(
  symbol: string,
  options: { maxAgeSeconds?: number } = {},
): Promise<QuoteResult> {
  if (!isMarketDataConfigured()) {
    return { ok: false, reason: MARKET_UNCONFIGURED_MESSAGE };
  }

  const key = normalizeSymbol(symbol);
  if (!key) return { ok: false, reason: "No investment was chosen." };

  const maxAge = options.maxAgeSeconds ?? QUOTE_TTL_SECONDS;
  const cached = await readCachedQuote(key);

  if (cached && ageSeconds(cached.fetched_at) < maxAge) {
    return { ok: true, quote: rowToQuote(cached, false) };
  }

  try {
    // Alpaca first (snapshots carry the real previous close and session OHLCV),
    // Finnhub fallback. When Alpaca answers but does not know the symbol we fall
    // through to Finnhub before declaring it unknown.
    let fresh: FreshQuote | null = null;
    if (isAlpacaConfigured()) {
      const alpaca = await fetchAlpacaSnapshots([key]);
      const hit = alpaca.snapshots.find((snapshot) => snapshot.symbol === key);
      if (hit) fresh = snapshotToFreshQuote(hit);
    }

    if (!fresh && isMarketDataConfigured()) {
      fresh = await fetchFinnhubQuote(key);
    }

    if (!fresh) {
      // The providers answered, but have no such instrument.
      if (cached) return { ok: true, quote: rowToQuote(cached, true) };
      return {
        ok: false,
        reason: `We couldn't find a price for ${key}. Check the ticker symbol and try again.`,
      };
    }

    await cacheQuote(fresh);
    await maybeSampleHistory(key, fresh.price);

    return { ok: true, quote: freshQuoteToQuote(fresh) };
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

  // One cache read for the whole batch, so a dashboard does not issue a query
  // per row.
  const cachedRows = await readCachedQuotes(unique);
  const needsFetch: string[] = [];

  for (const symbol of unique) {
    const row = cachedRows.get(symbol);
    if (row && ageSeconds(row.fetched_at) < QUOTE_TTL_SECONDS) {
      quotes.set(symbol, rowToQuote(row, false));
    } else {
      needsFetch.push(symbol);
    }
  }

  if (needsFetch.length === 0) return { quotes, failures };

  // Alpaca resolves the whole batch in one or two requests. Anything it cannot
  // price — or a provider failure — falls through to the per-symbol path, which
  // is where the Finnhub fallback and the stale-cache rules live.
  if (isAlpacaConfigured()) {
    try {
      const { snapshots } = await fetchAlpacaSnapshots(needsFetch);
      const fresh = snapshots.map(snapshotToFreshQuote);
      await cacheQuotes(fresh);

      // Sampling is best-effort: a failure to record history must never stop a
      // price from reaching the screen.
      await sampleHistoryBatch(
        new Map(fresh.map((quote) => [quote.symbol, quote.price])),
      ).catch(() => undefined);

      for (const quote of fresh) {
        quotes.set(quote.symbol, freshQuoteToQuote(quote));
      }

      const resolved = new Set(fresh.map((quote) => quote.symbol));
      await resolveIndividually(
        needsFetch.filter((symbol) => !resolved.has(symbol)),
        quotes,
        failures,
      );
      return { quotes, failures };
    } catch {
      // The batched call failed as a whole; price the batch one by one.
    }
  }

  await resolveIndividually(needsFetch, quotes, failures);
  return { quotes, failures };
}

/**
 * The per-symbol path: forces a fresh read so a symbol that the batched path
 * could not price is genuinely retried. Never throws.
 */
async function resolveIndividually(
  symbols: string[],
  quotes: Map<string, Quote>,
  failures: Map<string, string>,
): Promise<void> {
  if (symbols.length === 0) return;

  const results = await mapLimit(symbols, 4, async (symbol) => ({
    symbol,
    result: await getQuote(symbol, { maxAgeSeconds: 0 }),
  }));

  for (const { symbol, result } of results) {
    if (result.ok) quotes.set(symbol, result.quote);
    else failures.set(symbol, result.reason);
  }
}

export async function getQuotesForAssets(assets: Asset[]): Promise<QuoteMap> {
  return getQuotes(assets.map((asset) => asset.symbol));
}

// ---------------------------------------------------------------------------
// Market overview (spec §9)
// ---------------------------------------------------------------------------
export type MoverQuote = {
  symbol: string;
  displaySymbol: string;
  name: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  /** price x session volume — what "most active" is ranked on. */
  dollarVolume: number | null;
};

export type MarketMovers = {
  asOf: string | null;
  /** Broad-market ETFs, as index proxies. Resolved from the same snapshot. */
  indexes: MoverQuote[];
  gainers: MoverQuote[];
  losers: MoverQuote[];
  mostActive: MoverQuote[];
  /** Symbols in the universe the provider could not price this time. */
  failed: number;
};

/** Provider names for symbols this classroom already knows about. */
async function loadAssetNames(symbols: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (symbols.length === 0) return names;

  const db = createAdminClient();
  const { data } = await db.from("assets").select("symbol, name").in("symbol", symbols);
  for (const row of data ?? []) names.set(row.symbol, row.name);
  return names;
}

function toMover(
  snapshot: AlpacaSnapshot,
  names: Map<string, string>,
): MoverQuote {
  const { previousClose } = snapshot;
  const change = previousClose !== null ? snapshot.price - previousClose : null;
  const changePercent =
    change !== null && previousClose ? (change / previousClose) * 100 : null;

  return {
    symbol: snapshot.symbol,
    displaySymbol: snapshot.symbol,
    // Falls back to the ticker itself rather than to an invented company name.
    name: names.get(snapshot.symbol) ?? snapshot.symbol,
    price: snapshot.price,
    change,
    changePercent,
    volume: snapshot.volume,
    dollarVolume:
      snapshot.volume !== null ? snapshot.volume * snapshot.price : null,
  };
}

/**
 * The overview board: real top gainers, top losers and most-active names from a
 * live snapshot of the universe. Sections with nothing to show come back empty
 * and the UI says so — a movers table is never padded with fabricated rows.
 */
export async function getMarketMovers(
  options: { limit?: number } = {},
): Promise<MarketMovers> {
  const limit = options.limit ?? 5;
  const empty: MarketMovers = {
    asOf: null,
    indexes: [],
    gainers: [],
    losers: [],
    mostActive: [],
    failed: 0,
  };
  if (!isAlpacaConfigured()) return empty;

  const universe = [...OVERVIEW_SYMBOLS];

  let snapshots: AlpacaSnapshot[];
  try {
    snapshots = (await fetchAlpacaSnapshots(universe)).snapshots;
  } catch {
    // An overview panel is not worth failing a whole page for.
    return empty;
  }

  if (snapshots.length === 0) return empty;

  // Registered asset names win; the static label is the fund's name, never a
  // metric.
  const known = await loadAssetNames(snapshots.map((snapshot) => snapshot.symbol));
  const names = new Map<string, string>([
    ...INDEX_ETFS.map((entry) => [entry.symbol, entry.label] as [string, string]),
    ...known,
  ]);
  const rows = snapshots.map((snapshot) => toMover(snapshot, names));

  // Warm the shared quote cache with what the board just fetched, so opening an
  // asset straight from here does not cost another provider call.
  await cacheQuotes(snapshots.map(snapshotToFreshQuote)).catch(() => undefined);

  const byChange = rows
    .filter((row) => row.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));

  const indexOrder = INDEX_ETFS.map((entry) => entry.symbol);
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));

  return {
    asOf: new Date().toISOString(),
    indexes: indexOrder
      .map((symbol) => bySymbol.get(symbol))
      .filter((row): row is MoverQuote => row !== undefined),
    gainers: byChange
      .filter((row) => (row.changePercent ?? 0) > 0)
      .slice(0, limit),
    losers: byChange
      .filter((row) => (row.changePercent ?? 0) < 0)
      .slice(-limit)
      .reverse(),
    mostActive: rows
      .filter((row) => (row.dollarVolume ?? 0) > 0)
      .sort((a, b) => (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0))
      .slice(0, limit),
    failed: universe.length - snapshots.length,
  };
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
    return { ok: false, reason: "That doesn't look like a valid ticker symbol." };
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
      reason: `This investment couldn't be added to the market list. Please try again.`,
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
