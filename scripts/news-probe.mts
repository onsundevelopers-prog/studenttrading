/**
 * Alpha Vantage news integration probe.
 *
 * Exercises the real news service against the live provider: ticker news and its
 * relevance filtering, the sentiment tally, all four sort modes, request
 * deduplication, the topic feed, and the daily budget guard.
 *
 *   npx tsx scripts/news-probe.mts
 *
 * It spends a small number of Alpha Vantage requests (three or four), so run it
 * sparingly — the free tier allows 25 per day for the whole classroom. The
 * budget-guard steps drive the ceiling to zero locally rather than burning the
 * real allowance.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const { getTickerNews, getMarketNews, getNewsFeed, remainingQuota } = await import(
  "../src/lib/news/service"
);

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(
    `  ${ok ? "\u001b[32mPASS\u001b[0m" : "\u001b[31mFAIL\u001b[0m"} ${name}${detail ? ` — ${detail}` : ""}`,
  );
  if (ok) pass += 1;
  else fail += 1;
}

// 1. Ticker news — the first call must reach the provider.
const first = await getTickerNews("AAPL", { limit: 25 });
check("ticker news returns", first.ok, first.ok ? `${first.articles.length} articles` : first.reason);
if (!first.ok) process.exit(1);

check("first call reached the provider", first.cached === false);
check(
  "every article is tagged with the requested ticker",
  first.articles.every((article) => article.tickers.includes("AAPL")),
);
check(
  "articles respect the relevance floor",
  first.articles.every((article) => (article.focusRelevance ?? 0) >= 0.2),
);
check(
  "no fabricated fields",
  first.articles.every(
    (article) =>
      article.title &&
      /^https?:\/\//.test(article.url) &&
      article.source &&
      article.publishedAt &&
      article.summary,
  ),
);
check(
  "no article is dated in the future",
  first.articles.every(
    (article) => Date.parse(article.publishedAt) <= Date.now() + 60_000,
  ),
);
check(
  "sentiment counts sum to the article count",
  first.sentiment.counts.positive +
    first.sentiment.counts.neutral +
    first.sentiment.counts.negative ===
    first.sentiment.total,
  JSON.stringify(first.sentiment.percents),
);

// 2. Sorting must be free — served from cache with no upstream call.
const positive = await getTickerNews("AAPL", { sort: "positive", limit: 25 });
check("re-sorting is served from cache", positive.ok && positive.cached === true);
if (positive.ok) {
  const scores = positive.articles.map((article) => article.sentimentScore);
  check(
    "most-positive is descending",
    scores.every((score, i) => i === 0 || scores[i - 1] >= score),
  );
}

const negative = await getTickerNews("AAPL", { sort: "negative", limit: 25 });
if (negative.ok) {
  const scores = negative.articles.map((article) => article.sentimentScore);
  check(
    "most-negative is ascending",
    scores.every((score, i) => i === 0 || scores[i - 1] <= score),
  );
}

const relevant = await getTickerNews("AAPL", { sort: "relevant", limit: 25 });
if (relevant.ok) {
  const scores = relevant.articles.map((article) => article.focusRelevance ?? 0);
  check(
    "most-relevant is descending by focus relevance",
    scores.every((score, i) => i === 0 || scores[i - 1] >= score),
  );
}

// 3. Three concurrent requests for the same feed must cost one upstream call.
const concurrent = await Promise.all([
  getMarketNews({ limit: 20 }),
  getMarketNews({ limit: 20 }),
  getMarketNews({ limit: 20 }),
]);
const providerHits = concurrent.filter((result) => result.ok && result.cached === false).length;
check(
  "concurrent identical requests are deduplicated",
  providerHits <= 1,
  `${providerHits} of 3 reached the provider`,
);

// 4. Topic feed.
const tech = await getNewsFeed({ topics: ["technology"], limit: 20 });
check("topic feed returns", tech.ok, tech.ok ? `${tech.articles.length} articles` : tech.reason);

// 5. Budget guard: an uncached query with no allowance must not call out.
process.env.ALPHA_VANTAGE_DAILY_BUDGET = "0";
const blocked = await getNewsFeed({ topics: ["energy_transportation"], limit: 5 });
check(
  "a spent budget refuses to call out",
  !blocked.ok && blocked.code === "budget",
  blocked.ok ? "unexpectedly succeeded" : blocked.reason,
);

// 6. …but cached news is still served when the allowance is gone.
const cachedUnderBudget = await getMarketNews({ limit: 5 });
check(
  "cached news is still served with no budget",
  cachedUnderBudget.ok && cachedUnderBudget.cached === true,
  cachedUnderBudget.ok ? `stale=${cachedUnderBudget.stale}` : cachedUnderBudget.reason,
);
process.env.ALPHA_VANTAGE_DAILY_BUDGET = "20";

console.log("\nremaining allowance today:", await remainingQuota());
console.log(fail === 0 ? `\nAll ${pass} probes passed.` : `\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
