/**
 * One-off integration probe (spec §19 steps 1–4): loads the real modules and
 * exercises the Alpaca client + market-status service against the live API.
 *
 *   npx tsx scripts/alpaca-probe.mts
 */
import { readFileSync } from "node:fs";

// Load .env.local into process.env before importing modules that read it.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const { fetchAlpacaClock, fetchAlpacaQuotes, fetchAlpacaBars, toAlpacaSymbol } = await import(
  "../src/lib/market/alpaca"
);
const { getEquityMarketStatus, getMarketStatusFor } = await import(
  "../src/lib/market/market-status"
);

let failures = 0;
function step(name: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "\u001b[32mPASS\u001b[0m" : "\u001b[31mFAIL\u001b[0m"} ${name} — ${detail}`);
  if (!ok) failures += 1;
}

// 1. Clock / market status
const clock = await fetchAlpacaClock();
step("Alpaca clock reachable", clock !== null, `is_open=${clock?.isOpen}`);

const status = await getEquityMarketStatus();
step(
  "market status service resolves",
  ["pre_market", "regular", "after_hours", "closed"].includes(status.session),
  `${status.session} via ${status.source} — "${status.label}"`,
);

const cryptoStatus = await getMarketStatusFor("crypto");
step("crypto is always tradable", cryptoStatus.tradingAllowed, cryptoStatus.label);

// 2. Quotes — stock and crypto symbol mapping
const { quotes, unknown } = await fetchAlpacaQuotes(["AAPL", "MSFT", "BINANCE:BTCUSDT"]);
const aapl = quotes.find((q) => q.symbol === "AAPL");
const btc = quotes.find((q) => q.symbol === "BINANCE:BTCUSDT");
step(
  "AAPL quote",
  Boolean(aapl) && !unknown.includes("AAPL"),
  aapl ? `price=${aapl.price.toFixed(2)} bid=${aapl.bid} ask=${aapl.ask}` : "missing",
);
step(
  "BTC/USDT quote",
  Boolean(btc) && !unknown.includes("BINANCE:BTCUSDT"),
  btc ? `price=${btc.price.toFixed(2)}` : "missing",
);
step(
  "symbol mapping",
  toAlpacaSymbol("BINANCE:BTCUSDT") === "BTC/USD" && toAlpacaSymbol("AAPL") === "AAPL",
  "BINANCE:BTCUSDT -> BTC/USD",
);

// 3. Historical bars
const start = new Date();
start.setDate(start.getDate() - 30);
const bars = await fetchAlpacaBars("AAPL", { start, maxBars: 30 });
step("AAPL daily bars", bars.length > 0, `${bars.length} bars, last close=${bars.at(-1)?.c.toFixed(2)}`);

const cryptoBars = await fetchAlpacaBars("BINANCE:BTCUSDT", { start, maxBars: 30 });
step("BTC daily bars (v1beta3)", cryptoBars.length > 0, `${cryptoBars.length} bars`);

// 4. Price history service wrapper (graceful degradation when unconfigured)
const { getHistoricalBars } = await import("../src/lib/market/service");
const serviceBars = await getHistoricalBars("AAPL", { days: 30 });
step(
  "service getHistoricalBars",
  serviceBars.length > 0,
  `${serviceBars.length} bars mapped`,
);

console.log(failures === 0 ? "\nAll probes passed." : `\n${failures} probe(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
