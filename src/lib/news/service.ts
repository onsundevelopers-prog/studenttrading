import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  AlphaVantageError,
  fetchCompanyOverview,
  fetchNewsSentiment,
  isAlphaVantageConfigured,
  type CompanyOverview,
  type NewsArticle,
  type SentimentBucket,
} from "./alphavantage";

/**
 * The only place in the application that talks to Alpha Vantage.
 *
 * Alpha Vantage is the one upstream that cannot be called per request. A free
 * key allows one request per second and 25 per day, *shared by every student in
 * every classroom*, so this service exists mainly to make sure that budget is
 * spent rarely and never wasted:
 *
 *   1. An in-process cache absorbs repeat views inside one server instance.
 *   2. `news_cache` (migration 0006) absorbs them across instances, so a cold
 *      serverless start does not spend a request another instance already spent.
 *   3. Concurrent identical requests share one in-flight promise instead of
 *      racing to issue two calls.
 *   4. `consume_api_quota()` reserves a call atomically against a daily ceiling.
 *      When the ceiling is reached, cached news is served (flagged as stale)
 *      rather than failing, and only a completely empty cache produces the
 *      "temporarily unavailable" message.
 *
 * Nothing here is ever presented as live when it is not: every result carries
 * `fetchedAt`, and `stale` is set whenever cached data outlived its fresh TTL.
 */

export const NEWS_UNCONFIGURED_MESSAGE =
  "Financial news isn't set up yet. Ask your teacher to finish setting up the news source.";

export const NEWS_UNAVAILABLE_MESSAGE = "News temporarily unavailable.";

const PROVIDER = "alpha_vantage";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------
export type NewsSort = "latest" | "relevant" | "positive" | "negative";

export const NEWS_SORTS: ReadonlyArray<{ key: NewsSort; label: string }> = [
  { key: "latest", label: "Latest" },
  { key: "relevant", label: "Most relevant" },
  { key: "positive", label: "Most positive" },
  { key: "negative", label: "Most negative" },
];

export function isNewsSort(value: unknown): value is NewsSort {
  return (
    typeof value === "string" &&
    NEWS_SORTS.some((option) => option.key === value)
  );
}

export type SentimentDistribution = {
  total: number;
  counts: Record<SentimentBucket, number>;
  /** Percentages of `total`, 0 when there are no articles. */
  percents: Record<SentimentBucket, number>;
  averageScore: number | null;
};

export type NewsFeed = {
  articles: NewsArticle[];
  sentiment: SentimentDistribution;
  fetchedAt: string;
  /** True when the data outlived its fresh TTL and the budget is spent. */
  stale: boolean;
  /** True when this result came from cache rather than an upstream call. */
  cached: boolean;
};

/**
 * Why a news request could not be served. The user-facing message is the same
 * regardless (spec: "News temporarily unavailable"), but the code lets the UI
 * add an honest hint, because the remedy differs: a spent daily allowance comes
 * back on its own, a misconfigured key does not.
 */
export type NewsFailureCode =
  | "not_configured"
  | "budget"
  | "invalid_key"
  | "provider";

export type NewsResult =
  | ({ ok: true } & NewsFeed)
  | { ok: false; reason: string; code: NewsFailureCode };

export type OverviewResult =
  | { ok: true; overview: CompanyOverview; fetchedAt: string; stale: boolean }
  | { ok: false; reason: string; code: NewsFailureCode };

// ---------------------------------------------------------------------------
// TTLs
// ---------------------------------------------------------------------------
/** How long an upstream response is considered current. */
const TICKER_NEWS_TTL_MS = 15 * 60 * 1000;
const TOPIC_NEWS_TTL_MS = 15 * 60 * 1000;
/**
 * How long stale data may still be served, once its fresh TTL has passed and the
 * daily budget is exhausted. Outside this window the answer is "unavailable"
 * rather than possibly-days-old news presented as current.
 */
const STALE_SERVE_MS = 6 * 60 * 60 * 1000;
const OVERVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const OVERVIEW_STALE_SERVE_MS = 7 * 24 * 60 * 60 * 1000;

/** Relevance floor for a ticker-focused query; below this the article is noise. */
const RELEVANCE_FLOOR = 0.2;

// ---------------------------------------------------------------------------
// In-process cache (first layer) and request dedupe
// ---------------------------------------------------------------------------
type CacheEntry = {
  payload: unknown;
  fetchedAt: string;
  storedAt: number;
};

/** Set only when `0006_news.sql` has not been applied. */
let durableCacheUnavailable = false;

const memoryCache = new Map<string, CacheEntry>();
const MEMORY_MAX_ENTRIES = 60;
const inFlight = new Map<string, Promise<unknown>>();

// ---------------------------------------------------------------------------
// Durable cache (second layer)
// ---------------------------------------------------------------------------
/**
 * True only for "this object is not installed". A transient failure must not
 * permanently disable the shared cache, because that would quietly raise API
 * usage for the rest of the process's life.
 */
function isMissingObject(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42883") return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}

async function readDurableCache(
  key: string,
): Promise<{ payload: unknown; fetchedAt: string; expired: boolean } | null> {
  if (durableCacheUnavailable) return null;

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("news_cache")
      .select("payload, fetched_at, expires_at")
      .eq("cache_key", key)
      .maybeSingle();

    if (error) {
      if (isMissingObject(error)) durableCacheUnavailable = true;
      return null;
    }
    if (!data) return null;

    // `expires_at` is the *fresh* deadline, not the eviction deadline. How long
    // the row may still be served as stale is derived from `fetched_at` by the
    // caller, so the two windows stay independent.
    return {
      payload: data.payload,
      fetchedAt: data.fetched_at as string,
      expired: new Date(data.expires_at as string).getTime() <= Date.now(),
    };
  } catch {
    // A missing table (migration 0006 not applied) is not an error worth
    // surfacing: the in-process cache still works, it is just not shared.
    return null;
  }
}

async function writeDurableCache(
  key: string,
  payload: unknown,
  ttlMs: number,
): Promise<void> {
  if (durableCacheUnavailable) return;
  try {
    const db = createAdminClient();
    const { error } = await db.from("news_cache").upsert(
      {
        cache_key: key,
        payload,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      },
      { onConflict: "cache_key" },
    );
    // A transient write failure is retried on the next request; only a missing
    // table stops the attempt for the life of this process.
    if (error && isMissingObject(error)) durableCacheUnavailable = true;
  } catch {
    // Network hiccup: leave the durable cache enabled and try again later.
  }
}

/**
 * Drops rows that are long past their useful life. Runs occasionally rather
 * than on every write, because the cache table is tiny by design and a delete
 * per request would be pure overhead.
 */
let pruneTick = 0;
async function pruneDurableCache(): Promise<void> {
  if (durableCacheUnavailable) return;
  pruneTick += 1;
  if (pruneTick % 10 !== 0) return;
  try {
    const db = createAdminClient();
    // Nothing older than the stale-serve window can ever be served again.
    const cutoff = new Date(Date.now() - STALE_SERVE_MS).toISOString();
    await db.from("news_cache").delete().lt("fetched_at", cutoff);
  } catch {
    // Housekeeping only.
  }
}

// ---------------------------------------------------------------------------
// Daily budget
// ---------------------------------------------------------------------------
let memoryQuotaDay = "";
let memoryQuotaUsed = 0;

function memoryQuotaRemaining(limit: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (memoryQuotaDay !== day) {
    memoryQuotaDay = day;
    memoryQuotaUsed = 0;
  }
  if (memoryQuotaUsed >= limit) return false;
  memoryQuotaUsed += 1;
  return true;
}

/**
 * Reserves one upstream call for today. The decision is made in the database so
 * that concurrent requests across instances cannot collectively overshoot the
 * ceiling; if the counter table is unavailable the process-local counter takes
 * over, which is weaker but never absent.
 */
async function consumeQuota(): Promise<boolean> {
  const limit = serverEnv.alphaVantageDailyBudget;
  try {
    const { data, error } = await createAdminClient().rpc("consume_api_quota", {
      p_provider: PROVIDER,
      p_limit: limit,
    });
    if (!error && typeof data === "boolean") return data;
  } catch {
    // fall through to the process-local counter
  }
  return memoryQuotaRemaining(limit);
}

/** Remaining calls today, for diagnostics. Never calls upstream. */
export async function remainingQuota(): Promise<number | null> {
  const limit = serverEnv.alphaVantageDailyBudget;
  try {
    const { data, error } = await createAdminClient().rpc("remaining_api_quota", {
      p_provider: PROVIDER,
      p_limit: limit,
    });
    if (!error && typeof data === "number") return data;
    if (!error && data !== null) return Number(data);
  } catch {
    // fall through
  }
  return memoryQuotaDay === new Date().toISOString().slice(0, 10)
    ? Math.max(0, limit - memoryQuotaUsed)
    : limit;
}

// ---------------------------------------------------------------------------
// The cache-and-budget pipeline
// ---------------------------------------------------------------------------
function failureFrom(error: unknown): { reason: string; code: NewsFailureCode } {
  if (error instanceof AlphaVantageError) {
    if (error.kind === "not_configured") {
      return { reason: NEWS_UNCONFIGURED_MESSAGE, code: "not_configured" };
    }
    if (error.kind === "invalid_key") {
      return { reason: NEWS_UNAVAILABLE_MESSAGE, code: "invalid_key" };
    }
  }
  // Rate-limited, malformed, offline: all indistinguishable to a student, and
  // all transient as far as they are concerned.
  return { reason: NEWS_UNAVAILABLE_MESSAGE, code: "provider" };
}

type LoadOutcome<T> =
  | { ok: true; value: T; fetchedAt: string; stale: boolean; cached: boolean }
  | { ok: false; reason: string; code: NewsFailureCode };

/**
 * Serves `key` from cache when possible, refreshing it at most once per TTL.
 *
 * The ordering below is the whole point of this module:
 *   fresh memory → fresh durable → (budget? fetch : stale durable) → failure.
 */
async function withCache<T>(options: {
  key: string;
  ttlMs: number;
  staleServeMs: number;
  load: () => Promise<T>;
}): Promise<LoadOutcome<T>> {
  const { key, ttlMs, staleServeMs, load } = options;

  // The in-flight promise is registered *before* the first await. Registering it
  // later — after the cache reads or the budget reservation — leaves a window in
  // which three concurrent requests for the same key all pass the check and all
  // call the provider, which is exactly what the dedupe exists to prevent.
  const joined = inFlight.get(key) as Promise<LoadOutcome<T>> | undefined;
  if (joined) {
    const outcome = await joined;
    // A joiner caused no upstream call of its own, so its result is cached.
    return outcome.ok ? { ...outcome, cached: true } : outcome;
  }

  const work = run();
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }

  async function run(): Promise<LoadOutcome<T>> {
  const now = Date.now();

  const memory = memoryCache.get(key);
  if (memory && now - memory.storedAt < ttlMs) {
    return {
      ok: true,
      value: memory.payload as T,
      fetchedAt: memory.fetchedAt,
      stale: false,
      cached: true,
    };
  }

  const durable = await readDurableCache(key);

  if (durable && !durable.expired) {
    const storedAt = new Date(durable.fetchedAt).getTime();
    memoryCache.set(key, {
      payload: durable.payload,
      fetchedAt: durable.fetchedAt,
      storedAt,
    });
    return {
      ok: true,
      value: durable.payload as T,
      fetchedAt: durable.fetchedAt,
      stale: false,
      cached: true,
    };
  }

  // A refresh is wanted, and this caller owns it.
  const reserved = await consumeQuota();
  if (!reserved) {
    // Budget spent. Cached data is still served, but only while it is recent
    // enough to be worth showing — and it is flagged so the UI can say so.
    if (durable) {
      const age = now - new Date(durable.fetchedAt).getTime();
      if (age <= staleServeMs) {
        memoryCache.set(key, {
          payload: durable.payload,
          fetchedAt: durable.fetchedAt,
          storedAt: new Date(durable.fetchedAt).getTime(),
        });
        return {
          ok: true,
          value: durable.payload as T,
          fetchedAt: durable.fetchedAt,
          stale: true,
          cached: true,
        };
      }
    }
    return {
      ok: false,
      reason: NEWS_UNAVAILABLE_MESSAGE,
      code: "budget",
    };
  }

  // The reservation is already spent, so a failure past this point is a real
  // failure: fall back to cached data if it exists, and never pretend the
  // refresh happened when it did not.
  try {
    const value = await load();
    const fetchedAt = new Date().toISOString();

    if (memoryCache.size >= MEMORY_MAX_ENTRIES) {
      const oldest = [...memoryCache.entries()].sort(
        (a, b) => a[1].storedAt - b[1].storedAt,
      )[0];
      if (oldest) memoryCache.delete(oldest[0]);
    }
    memoryCache.set(key, { payload: value, fetchedAt, storedAt: Date.now() });

    // The row's fresh life is the TTL. How long it may *also* be served as stale
    // is derived from `fetched_at`, so the two windows never collapse into one.
    await writeDurableCache(key, value, ttlMs);
    await pruneDurableCache();

    return { ok: true, value, fetchedAt, stale: false, cached: false };
  } catch (error) {
    // A failed refresh must not throw away good cached data.
    if (durable) {
      return {
        ok: true,
        value: durable.payload as T,
        fetchedAt: durable.fetchedAt,
        stale: true,
        cached: true,
      };
    }
    return { ok: false, ...failureFrom(error) };
  }
  }
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------
/** Counts the provider's own labels. Nothing here is generated or estimated. */
export function distributionOf(articles: NewsArticle[]): SentimentDistribution {
  const counts: Record<SentimentBucket, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  let sum = 0;

  for (const article of articles) {
    counts[article.sentimentBucket] += 1;
    sum += article.sentimentScore;
  }

  const total = articles.length;
  const percent = (value: number) =>
    total === 0 ? 0 : Math.round((value / total) * 1000) / 10;

  return {
    total,
    counts,
    percents: {
      positive: percent(counts.positive),
      neutral: percent(counts.neutral),
      negative: percent(counts.negative),
    },
    averageScore: total === 0 ? null : sum / total,
  };
}

/**
 * Sorting is done on the articles already fetched, so switching sort order
 * costs no API calls. Each mode is computed from real provider fields:
 *   latest    → publication time
 *   relevant  → the focus ticker's relevance score (or the provider's own
 *               relevance ordering when no single ticker is in focus)
 *   positive  → article sentiment score, descending
 *   negative  → article sentiment score, ascending
 */
export function sortArticles(
  articles: NewsArticle[],
  sort: NewsSort,
  focusTicker: string | null,
): NewsArticle[] {
  const copy = [...articles];

  switch (sort) {
    case "relevant":
      // Without a single focus ticker there is no per-article relevance score to
      // sort on, so the provider's relevance ordering is preserved instead of
      // inventing one.
      if (!focusTicker) return copy;
      return copy.sort(
        (a, b) =>
          (b.focusRelevance ?? 0) - (a.focusRelevance ?? 0) ||
          Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
      );
    case "positive":
      return copy.sort((a, b) => b.sentimentScore - a.sentimentScore);
    case "negative":
      return copy.sort((a, b) => a.sentimentScore - b.sentimentScore);
    case "latest":
    default:
      return copy.sort(
        (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
      );
  }
}

// ---------------------------------------------------------------------------
// Ticker news
// ---------------------------------------------------------------------------
/**
 * News genuinely about one ticker.
 *
 * Alpha Vantage's `tickers` parameter is a relevance filter, not an exclusive
 * one — asking for AAPL also returns articles that merely mention Apple. So the
 * feed is cut down to articles the provider actually tagged with that ticker
 * above a relevance floor, newest first. That is what "no unrelated news" has to
 * mean if the page is to be trustworthy.
 */
export async function getTickerNews(
  symbol: string,
  options: { sort?: NewsSort; limit?: number } = {},
): Promise<NewsResult> {
  if (!isAlphaVantageConfigured()) {
    return {
      ok: false,
      reason: NEWS_UNCONFIGURED_MESSAGE,
      code: "not_configured",
    };
  }

  const ticker = symbol.trim().toUpperCase();
  if (!ticker) {
    return {
      ok: false,
      reason: "No company was selected for this news feed.",
      code: "provider",
    };
  }

  const outcome = await withCache<NewsArticle[]>({
    // The key is the ticker alone: results are cached unfiltered and sorted in
    // memory, so changing sort order or page never costs an upstream call.
    key: `news:ticker:${ticker}`,
    ttlMs: TICKER_NEWS_TTL_MS,
    staleServeMs: STALE_SERVE_MS,
    load: async () => {
      const articles = await fetchNewsSentiment({
        tickers: [ticker],
        limit: 50,
        sort: "RELEVANCE",
      });
      return articles.filter(
        (article) =>
          article.tickers.includes(ticker) &&
          (article.focusRelevance ?? 0) >= RELEVANCE_FLOOR,
      );
    },
  });

  if (!outcome.ok) return outcome;

  const articles = sortArticles(
    outcome.value,
    options.sort ?? "latest",
    ticker,
  ).slice(0, options.limit ?? 40);

  return {
    ok: true,
    articles,
    sentiment: distributionOf(outcome.value),
    fetchedAt: outcome.fetchedAt,
    stale: outcome.stale,
    cached: outcome.cached,
  };
}

// ---------------------------------------------------------------------------
// Topic / market news
// ---------------------------------------------------------------------------
export type NewsFeedRequest = {
  topics?: string[];
  tickers?: string[];
  sort?: NewsSort;
  limit?: number;
};

/**
 * Market, topic or multi-ticker news. Topic slugs are the provider's own, so
 * they are used verbatim rather than guessed at.
 */
export async function getNewsFeed(
  request: NewsFeedRequest = {},
): Promise<NewsResult> {
  if (!isAlphaVantageConfigured()) {
    return {
      ok: false,
      reason: NEWS_UNCONFIGURED_MESSAGE,
      code: "not_configured",
    };
  }

  const topics = (request.topics ?? []).map((topic) => topic.trim()).filter(Boolean).sort();
  const tickers = (request.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean).sort();
  const focusTicker = tickers.length === 1 ? tickers[0] : null;

  // No filter at all means the broad market feed, not a ticker query.
  if (topics.length === 0 && tickers.length === 0) {
    return getMarketNews({ sort: request.sort, limit: request.limit });
  }

  const key = `news:feed:${topics.join("+") || "-"}:${tickers.join("+") || "-"}`;

  const outcome = await withCache<NewsArticle[]>({
    key,
    ttlMs: TOPIC_NEWS_TTL_MS,
    staleServeMs: STALE_SERVE_MS,
    load: () =>
      fetchNewsSentiment({
        topics,
        tickers,
        limit: 50,
        sort: "LATEST",
      }),
  });

  if (!outcome.ok) return outcome;

  const articles = sortArticles(outcome.value, request.sort ?? "latest", focusTicker).slice(
    0,
    request.limit ?? 40,
  );

  return {
    ok: true,
    articles,
    sentiment: distributionOf(outcome.value),
    fetchedAt: outcome.fetchedAt,
    stale: outcome.stale,
    cached: outcome.cached,
  };
}

/** Broad market news: the provider's own feed, unfiltered. */
export async function getMarketNews(
  options: { sort?: NewsSort; limit?: number } = {},
): Promise<NewsResult> {
  if (!isAlphaVantageConfigured()) {
    return {
      ok: false,
      reason: NEWS_UNCONFIGURED_MESSAGE,
      code: "not_configured",
    };
  }

  const outcome = await withCache<NewsArticle[]>({
    key: "news:market",
    ttlMs: TOPIC_NEWS_TTL_MS,
    staleServeMs: STALE_SERVE_MS,
    load: () => fetchNewsSentiment({ limit: 50, sort: "LATEST" }),
  });

  if (!outcome.ok) return outcome;

  return {
    ok: true,
    articles: sortArticles(outcome.value, options.sort ?? "latest", null).slice(
      0,
      options.limit ?? 40,
    ),
    sentiment: distributionOf(outcome.value),
    fetchedAt: outcome.fetchedAt,
    stale: outcome.stale,
    cached: outcome.cached,
  };
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------
/**
 * Company fundamentals for one symbol, cached for a day. Fundamentals move
 * slowly; spending one of 25 daily calls on the same symbol twice in a day
 * would be waste.
 */
export async function getCompanyOverview(
  symbol: string,
): Promise<OverviewResult> {
  if (!isAlphaVantageConfigured()) {
    return {
      ok: false,
      reason: NEWS_UNCONFIGURED_MESSAGE,
      code: "not_configured",
    };
  }

  const ticker = symbol.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, reason: "No company was selected.", code: "provider" };
  }

  const outcome = await withCache<CompanyOverview | null>({
    key: `overview:${ticker}`,
    ttlMs: OVERVIEW_TTL_MS,
    staleServeMs: OVERVIEW_STALE_SERVE_MS,
    load: () => fetchCompanyOverview(ticker),
  });

  if (!outcome.ok) return outcome;
  if (!outcome.value) {
    return {
      ok: false,
      reason: `No company information is available for ${ticker}.`,
      code: "provider",
    };
  }

  return {
    ok: true,
    overview: outcome.value,
    fetchedAt: outcome.fetchedAt,
    stale: outcome.stale,
  };
}
