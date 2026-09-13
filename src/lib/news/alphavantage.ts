import { serverEnv } from "@/lib/env";

/**
 * Server-only wrapper around Alpha Vantage's NEWS_SENTIMENT and OVERVIEW
 * endpoints.
 *
 * Architecture rule: Alpha Vantage is the source of NEWS, SENTIMENT and company
 * fundamentals only. It is never a price source — Alpaca owns prices, candles
 * and the market clock — and it never touches money, orders or portfolios.
 *
 * The critical difference from the Alpaca and Finnhub clients: Alpha Vantage
 * takes its key as a **URL query parameter**. A URL is far more likely to end
 * up in a log line, an error message or a thrown exception than a header is, so
 * everything in this module is written to keep it out:
 *   - errors carry the endpoint name only, never the URL;
 *   - `redact()` exists so any accidental stringified error can be cleaned;
 *   - the key is appended last, at request time, and never stored on an object.
 *
 * Two upstream limits are real and are respected here: 5 requests/minute and
 * 25 requests/day on the free tier. This module enforces the per-minute pace;
 * the daily ceiling is enforced in `service.ts`, where the shared budget lives.
 */

const BASE_URL = "https://www.alphavantage.co/query";
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * A free Alpha Vantage key is limited to one request per second and 25 per day.
 * The provider says so itself when two calls land too close together:
 *
 *   "Please consider spreading out your free API requests more sparingly
 *    (1 request per second)."
 *
 * So spacing — not a per-minute bucket — is what has to be enforced here. A
 * limit that only counted calls per minute would happily fire three in one
 * burst and have two of them rejected.
 */
const MIN_INTERVAL_MS = 1_200;
const MAX_REQUESTS_PER_MINUTE = 5;

export type AlphaVantageErrorKind =
  | "not_configured"
  | "rate_limited"
  | "invalid_key"
  | "unavailable"
  | "malformed";

export class AlphaVantageError extends Error {
  readonly kind: AlphaVantageErrorKind;

  constructor(kind: AlphaVantageErrorKind, message: string) {
    // Message is deliberately free of the request URL — that URL holds the key.
    super(message);
    this.name = "AlphaVantageError";
    this.kind = kind;
  }
}

export function isAlphaVantageConfigured(): boolean {
  return Boolean(process.env.ALPHA_VANTAGE_API_KEY?.trim());
}

/** Removes a key from any string that might be shown or logged. */
export function redact(value: string): string {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!key) return value;
  return value.split(key).join("[redacted]");
}

// ---------------------------------------------------------------------------
// Per-minute pacing
// ---------------------------------------------------------------------------
const callTimestamps: number[] = [];
let lastCallAt = 0;

async function waitForSlot(): Promise<void> {
  const windowMs = 60_000;

  for (;;) {
    const now = Date.now();
    while (callTimestamps.length > 0 && now - callTimestamps[0] > windowMs) {
      callTimestamps.shift();
    }

    const spacing = Math.max(0, MIN_INTERVAL_MS - (now - lastCallAt));
    const rateWait =
      callTimestamps.length >= MAX_REQUESTS_PER_MINUTE
        ? windowMs - (now - callTimestamps[0]) + 25
        : 0;

    if (spacing <= 0 && rateWait <= 0) {
      lastCallAt = now;
      callTimestamps.push(now);
      return;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(spacing, rateWait, 25)),
    );
  }
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------
type RawRecord = Record<string, unknown>;

/**
 * Alpha Vantage answers HTTP 200 for rate limits and bad keys, putting the
 * problem in an `Information` / `Note` / `Error Message` field instead. So the
 * body has to be inspected, not just the status code.
 */
function softErrorOf(body: RawRecord): AlphaVantageError | null {
  const message = [body["Error Message"], body["Information"], body["Note"]]
    .find((value) => typeof value === "string" && value.trim() !== "") as
    | string
    | undefined;

  if (!message) return null;

  const lowered = message.toLowerCase();

  if (lowered.includes("rate limit") || lowered.includes("per minute")) {
    return new AlphaVantageError(
      "rate_limited",
      "The news provider's rate limit was reached. Try again in a minute.",
    );
  }

  if (
    lowered.includes("25 requests per day") ||
    lowered.includes("per day") ||
    lowered.includes("daily rate limit") ||
    lowered.includes("premium") ||
    lowered.includes("subscribe")
  ) {
    return new AlphaVantageError(
      "rate_limited",
      "The news provider's daily request allowance is used up. News will return when it resets.",
    );
  }

  if (lowered.includes("api key") || lowered.includes("apikey")) {
    return new AlphaVantageError(
      "invalid_key",
      "The news provider rejected the configured API key.",
    );
  }

  return new AlphaVantageError(
    "unavailable",
    "The news provider returned an unexpected response.",
  );
}

async function request(
  params: Record<string, string>,
): Promise<RawRecord> {
  if (!isAlphaVantageConfigured()) {
    throw new AlphaVantageError(
      "not_configured",
      "Financial news is not configured. Set ALPHA_VANTAGE_API_KEY.",
    );
  }

  await waitForSlot();

  const url = new URL(BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  // Appended last, and never included in an error.
  url.searchParams.set("apikey", serverEnv.alphaVantageApiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    throw new AlphaVantageError(
      "unavailable",
      aborted
        ? "The news provider timed out."
        : "Could not reach the news provider.",
    );
  }

  if (response.status === 429) {
    throw new AlphaVantageError(
      "rate_limited",
      "The news provider's rate limit was reached. Try again in a minute.",
    );
  }

  if (!response.ok) {
    throw new AlphaVantageError(
      "unavailable",
      `The news provider returned status ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AlphaVantageError(
      "malformed",
      "The news provider returned malformed data.",
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AlphaVantageError(
      "malformed",
      "The news provider returned malformed data.",
    );
  }

  const record = body as RawRecord;
  const softError = softErrorOf(record);
  if (softError) throw softError;

  return record;
}

// ---------------------------------------------------------------------------
// Normalised shapes
// ---------------------------------------------------------------------------
export type SentimentBucket = "positive" | "neutral" | "negative";

export type NewsArticle = {
  /** Stable identity for React keys and de-duplication. */
  id: string;
  title: string;
  url: string;
  source: string;
  sourceDomain: string | null;
  publishedAt: string;
  summary: string;
  authors: string[];
  bannerImage: string | null;
  topics: string[];
  /** Every ticker Alpha Vantage associated with the article. */
  tickers: string[];
  /** The ticker whose score is exposed below, when one was requested. */
  focusTicker: string | null;
  focusRelevance: number | null;
  /** Overall article sentiment, straight from the provider (-1 … 1). */
  sentimentScore: number;
  /** Provider's own label, normalised to its five documented buckets. */
  sentimentLabel: string;
  /** The label collapsed to three buckets for distribution counts. */
  sentimentBucket: SentimentBucket;
};

export type MarketNewsOptions = {
  /** Ticker symbols to focus on, e.g. ["AAPL"]. */
  tickers?: string[];
  /** Alpha Vantage topic slugs, e.g. ["technology"]. */
  topics?: string[];
  limit?: number;
  sort?: "LATEST" | "EARLIEST" | "RELEVANCE";
};

type RawTickerSentiment = {
  ticker?: string;
  relevance_score?: string;
  ticker_sentiment_score?: string;
  ticker_sentiment_label?: string;
};

type RawNewsItem = {
  title?: string;
  url?: string;
  time_published?: string;
  authors?: string[];
  summary?: string;
  banner_image?: string;
  source?: string;
  category_within_source?: string;
  source_domain?: string;
  topics?: Array<{ topic?: string; relevance_score?: string }>;
  overall_sentiment_score?: number | string;
  overall_sentiment_label?: string;
  ticker_sentiment?: RawTickerSentiment[];
};

const POSITIVE_LABELS = new Set(["bullish", "somewhat-bullish"]);
const NEGATIVE_LABELS = new Set(["bearish", "somewhat-bearish"]);

function bucketFor(label: string): SentimentBucket {
  const lowered = label.trim().toLowerCase();
  if (POSITIVE_LABELS.has(lowered)) return "positive";
  if (NEGATIVE_LABELS.has(lowered)) return "negative";
  return "neutral";
}

/**
 * Alpha Vantage publishes `time_published` as `YYYYMMDDTHHMMSS` with no zone
 * marker. Its convention is US/Eastern — the same zone its own docs use for
 * trading hours — so the value is read as America/New_York.
 *
 * That reading is still sanity-checked: if it would place an article in the
 * future, the value is re-read as UTC. A future-dated article is never shown,
 * and the timestamp stays honest if the provider ever changes convention.
 */
export function parsePublishedAt(raw: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(raw.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  // Eastern time expressed as a fixed offset, resolved through the IANA zone so
  // daylight saving is handled.
  const asIfEastern = zonedToUtc(y, mo, d, h, mi, s);
  if (asIfEastern === null) return null;

  const oneHour = 60 * 60 * 1000;
  if (asIfEastern.getTime() - Date.now() > oneHour) {
    const asUtc = new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
    );
    return asUtc.toISOString();
  }

  return asIfEastern.toISOString();
}

/**
 * Interprets a wall-clock time as America/New_York and returns the UTC instant.
 *
 * `naive` is the wall clock read as if it were UTC, so the instant is that plus
 * the zone's offset (UTC − local). Two passes settle a DST boundary; one is
 * enough for every other day of the year.
 */
function zonedToUtc(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
): Date | null {
  const naive = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (Number.isNaN(naive)) return null;

  const first = new Date(naive + easternOffsetMinutes(new Date(naive)) * 60_000);
  return new Date(naive + easternOffsetMinutes(first) * 60_000);
}

/** Minutes that UTC is ahead of America/New_York at `instant` (+240 in EDT). */
function easternOffsetMinutes(instant: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (instant.getTime() - asUtc) / 60_000;
}

function numberOr(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Only http(s) URLs are ever rendered as links or image sources. */
function isSafeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normaliseArticle(
  raw: RawNewsItem,
  focus: string | null,
): NewsArticle | null {
  const title = String(raw.title ?? "").trim();
  const url = String(raw.url ?? "").trim();
  // An article with no link is not displayable, and a non-http scheme (which a
  // publisher's CDN could in principle return) must never become an href.
  if (!title || !isSafeUrl(url)) return null;

  const publishedAt = raw.time_published
    ? parsePublishedAt(String(raw.time_published))
    : null;
  if (!publishedAt) return null; // never invent a timestamp

  const score = numberOr(raw.overall_sentiment_score) ?? 0;
  const label = String(raw.overall_sentiment_label ?? "").trim() || "Neutral";

  const tickerSentiment = Array.isArray(raw.ticker_sentiment)
    ? raw.ticker_sentiment
    : [];
  const tickers = tickerSentiment
    .map((entry) => String(entry.ticker ?? "").trim().toUpperCase())
    .filter(Boolean);

  const focusEntry = focus
    ? tickerSentiment.find(
        (entry) => String(entry.ticker ?? "").trim().toUpperCase() === focus,
      )
    : undefined;

  const banner = String(raw.banner_image ?? "").trim();

  return {
    id: `${url}`,
    title,
    url,
    source: String(raw.source ?? "").trim() || "Unknown source",
    sourceDomain: String(raw.source_domain ?? "").trim() || null,
    publishedAt,
    summary: String(raw.summary ?? "").trim(),
    authors: Array.isArray(raw.authors)
      ? raw.authors.map((author) => String(author)).filter(Boolean)
      : [],
    bannerImage: isSafeUrl(banner) ? banner : null,
    topics: (raw.topics ?? [])
      .map((topic) => String(topic.topic ?? "").trim())
      .filter(Boolean),
    tickers,
    focusTicker: focusEntry ? focus : null,
    focusRelevance: focusEntry ? numberOr(focusEntry.relevance_score) : null,
    sentimentScore: score,
    sentimentLabel: label,
    sentimentBucket: bucketFor(label),
  };
}

/**
 * NEWS_SENTIMENT.
 *
 * `tickers` is a relevance filter upstream, not an exclusive one: asking for
 * AAPL still returns articles that only mention AAPL in passing. Filtering to
 * genuinely relevant articles is the caller's job (see `service.ts`), because
 * only the caller knows whether it asked by ticker or by topic.
 */
export async function fetchNewsSentiment(
  options: MarketNewsOptions = {},
): Promise<NewsArticle[]> {
  const params: Record<string, string> = {
    function: "NEWS_SENTIMENT",
    limit: String(Math.min(Math.max(options.limit ?? 50, 1), 1000)),
    sort: options.sort ?? "LATEST",
  };

  const tickers = (options.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const topics = (options.topics ?? []).map((t) => t.trim()).filter(Boolean);

  if (tickers.length > 0) params.tickers = tickers.join(",");
  if (topics.length > 0) params.topics = topics.join(",");

  const body = await request(params);
  const feed = Array.isArray(body.feed) ? (body.feed as RawNewsItem[]) : [];
  const focus = tickers.length === 1 ? tickers[0] : null;

  return feed
    .map((item) => normaliseArticle(item, focus))
    .filter((article): article is NewsArticle => article !== null);
}

// ---------------------------------------------------------------------------
// Company overview — fundamentals
// ---------------------------------------------------------------------------
export type CompanyOverview = {
  symbol: string;
  name: string | null;
  description: string | null;
  exchange: string | null;
  currency: string | null;
  country: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  peRatio: number | null;
  pegRatio: number | null;
  dividendYield: number | null;
  profitMargin: number | null;
  week52High: number | null;
  week52Low: number | null;
  sharesOutstanding: number | null;
};

/**
 * OVERVIEW. Slower-moving than news and one call per symbol, so the caller
 * caches it for a day.
 */
export async function fetchCompanyOverview(
  symbol: string,
): Promise<CompanyOverview | null> {
  const body = await request({ function: "OVERVIEW", symbol: symbol.trim().toUpperCase() });

  // An unknown symbol comes back as an empty object, not an error.
  const name = String(body.Name ?? "").trim();
  if (!name) return null;

  const text = (key: string) => String(body[key] ?? "").trim() || null;
  const number = (key: string) => {
    const value = numberOr(body[key]);
    // Alpha Vantage writes "None" or "-" for a figure it does not have.
    return value !== null && value !== 0 ? value : null;
  };

  return {
    symbol: String(body.Symbol ?? symbol).trim().toUpperCase(),
    name,
    description: text("Description"),
    exchange: text("Exchange"),
    currency: text("Currency"),
    country: text("Country"),
    sector: text("Sector"),
    industry: text("Industry"),
    marketCap: number("MarketCapitalization"),
    peRatio: number("PERatio"),
    pegRatio: number("PEGRatio"),
    dividendYield: number("DividendYield"),
    profitMargin: number("ProfitMargin"),
    week52High: number("52WeekHigh"),
    week52Low: number("52WeekLow"),
    sharesOutstanding: number("SharesOutstanding"),
  };
}
