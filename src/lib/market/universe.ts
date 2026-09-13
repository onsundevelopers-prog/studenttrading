/**
 * The symbols the market overview samples.
 *
 * This file contains **tickers and fund names only — no prices, no ranks, no
 * volumes, no positions**. Every number attached to these symbols is fetched
 * from the market data provider at request time.
 *
 * It is deliberately small and liquid: the whole overview resolves in a single
 * batched snapshot call, which is what keeps a forty-row screen affordable on a
 * classroom-size market data plan. A student's own holdings and watchlist are
 * not limited to this list — it only decides what the overview board samples.
 */

/** Broad-market ETFs used as index proxies. Alpaca exposes no index feed. */
export const INDEX_ETFS: ReadonlyArray<{ symbol: string; label: string }> = [
  { symbol: "SPY", label: "SPDR S&P 500 ETF Trust" },
  { symbol: "QQQ", label: "Invesco QQQ Trust" },
  { symbol: "DIA", label: "SPDR Dow Jones Industrial Average ETF" },
  { symbol: "IWM", label: "iShares Russell 2000 ETF" },
];

/** Large, liquid US listings across sectors. */
export const MARKET_UNIVERSE: readonly string[] = [
  // Technology and communication
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "AVGO",
  "AMD",
  "INTC",
  "QCOM",
  "TXN",
  "ORCL",
  "CRM",
  "ADBE",
  "NFLX",
  "DIS",
  "UBER",
  "PYPL",
  "PLTR",
  "COIN",
  "IBM",
  // Financials
  "JPM",
  "BAC",
  "WFC",
  "GS",
  "MS",
  "C",
  "V",
  "MA",
  // Health care
  "UNH",
  "JNJ",
  "PFE",
  "MRK",
  "ABBV",
  "LLY",
  // Consumer
  "WMT",
  "COST",
  "HD",
  "MCD",
  "NKE",
  "KO",
  "PEP",
  "PG",
  // Energy, industrial, transport
  "XOM",
  "CVX",
  "BA",
  "CAT",
  "GE",
  "F",
  "DAL",
];

/** Everything the overview samples, index ETFs included. */
export const OVERVIEW_SYMBOLS: readonly string[] = [
  ...INDEX_ETFS.map((entry) => entry.symbol),
  ...MARKET_UNIVERSE,
];
