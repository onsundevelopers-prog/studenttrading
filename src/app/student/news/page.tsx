import Link from "next/link";

import { NewsList } from "@/components/news/news-list";
import { SentimentPanel } from "@/components/news/sentiment-panel";
import { Notice, Panel, PanelHeader } from "@/components/ui/primitives";
import { getStudentWorkspace } from "@/lib/auth/context";
import { loadPortfolio, loadWatchlist } from "@/lib/data/queries";
import { formatDateTime } from "@/lib/format";
import {
  getMarketNews,
  getNewsFeed,
  isNewsSort,
  NEWS_SORTS,
  type NewsResult,
  type NewsSort,
} from "@/lib/news/service";
import { cn } from "@/lib/utils";

/**
 * Market news.
 *
 * Every tab maps onto something the provider actually supports — a real topic
 * slug, or the student's own tickers. "For you" is not a recommendation engine:
 * it is the same feed queried for the assets this student already holds or
 * watches, and it says so.
 *
 * Sorting is applied to the articles already fetched, so changing sort order
 * costs no API calls. Nothing here is generated, and a tab with no articles
 * shows an empty state rather than filler.
 */

const TABS = [
  { key: "for-you", label: "For you" },
  { key: "market", label: "Market" },
  { key: "stocks", label: "Stocks" },
  { key: "crypto", label: "Crypto" },
  { key: "technology", label: "Technology" },
  { key: "energy", label: "Energy" },
  { key: "financials", label: "Financials" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * The provider's own topic slugs. There is no "stocks" or "crypto" topic, so
 * those two tabs are built from the closest real ones rather than invented —
 * earnings and financial markets for stocks, blockchain for crypto.
 */
const TOPIC_TABS: Partial<Record<TabKey, string[]>> = {
  stocks: ["earnings", "financial_markets"],
  crypto: ["blockchain"],
  technology: ["technology"],
  energy: ["energy_transportation"],
  financials: ["finance"],
};

const PERSONAL_TICKER_LIMIT = 8;

export default async function StudentNewsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; sort?: string }>;
}) {
  const { classroom, session } = await getStudentWorkspace();
  if (!classroom) return null;

  const params = await searchParams;
  const tab: TabKey =
    TABS.find((candidate) => candidate.key === params.tab)?.key ?? "for-you";
  const sort: NewsSort = isNewsSort(params.sort) ? params.sort : "latest";

  // "For you" personalisation comes from the student's real positions and
  // watchlist — the two things the database already knows about them.
  let personalTickers: string[] = [];
  if (tab === "for-you") {
    const [portfolio, watchlist] = await Promise.all([
      loadPortfolio(classroom.id, session.userId),
      loadWatchlist(classroom.id, session.userId),
    ]);
    personalTickers = Array.from(
      new Set([
        ...(portfolio?.holdings ?? []).map((holding) => holding.symbol),
        ...watchlist.map((entry) => entry.asset.symbol),
      ]),
    )
      .filter((symbol) => !symbol.includes(":")) // news covers equities, not crypto pairs
      .slice(0, PERSONAL_TICKER_LIMIT);
  }

  const topics = TOPIC_TABS[tab];

  let result: NewsResult;
  if (tab === "market" || (tab === "for-you" && personalTickers.length === 0)) {
    result = await getMarketNews({ sort });
  } else if (tab === "for-you") {
    result = await getNewsFeed({ tickers: personalTickers, sort });
  } else {
    result = await getNewsFeed({ topics: topics ?? [], sort });
  }

  const scopeNote =
    tab === "for-you"
      ? personalTickers.length > 0
        ? `Articles about ${personalTickers.join(", ")} — the investments you own or follow.`
        : "You don't own or follow anything yet, so this shows broad market headlines instead."
      : tab === "market"
        ? "Broad market headlines from our news source, newest first."
        : `Articles tagged with ${(topics ?? []).join(" or ").replace(/_/g, " ")}.`;

  function hrefFor(nextTab: TabKey, nextSort: NewsSort) {
    const search = new URLSearchParams();
    search.set("tab", nextTab);
    if (nextSort !== "latest") search.set("sort", nextSort);
    return `/student/news?${search.toString()}`;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-title font-medium text-ink">News</h1>
        <p className="mt-1.5 text-[12px] text-ink-tertiary">
          Financial news and sentiment from Alpha Vantage. The headlines,
          timestamps, publishers and sentiment scores all come from that news
          source — nothing here is written or estimated by this application.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((candidate) => (
          <Link
            key={candidate.key}
            href={hrefFor(candidate.key, sort)}
            className={cn(
              "rounded-full border px-3 py-[4px] text-[12px] transition-colors",
              candidate.key === tab
                ? "border-brand/45 bg-brand/15 text-[#a8b1ff]"
                : "border-hairline bg-surface-2 text-ink-subtle hover:text-ink",
            )}
          >
            {candidate.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[12px] leading-relaxed text-ink-tertiary">
          {scopeNote}
        </p>
        <div
          className="flex items-center gap-0.5 rounded-md border border-hairline bg-surface-2 p-0.5"
          role="group"
          aria-label="Sort news"
        >
          {NEWS_SORTS.map((option) => (
            <Link
              key={option.key}
              href={hrefFor(tab, option.key)}
              scroll={false}
              aria-current={option.key === sort}
              className={cn(
                "rounded-[4px] px-2 py-[3px] text-[11px] font-medium leading-none transition-colors",
                option.key === sort
                  ? "bg-surface-4 text-ink"
                  : "text-ink-tertiary hover:text-ink-muted",
              )}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {!result.ok ? (
        <div className="space-y-2">
          <Notice tone="warn">{result.reason}</Notice>
          {result.code === "budget" ? (
            <p className="text-[11px] leading-relaxed text-ink-tertiary">
              This classroom shares one free news allowance of 25 requests a day.
              It has been used up, so cached coverage is being served until it
              resets. Nothing is generated to fill the gap.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {result.stale ? (
            <Notice tone="warn">
              Showing cached news last updated {formatDateTime(result.fetchedAt)}.
              The provider is not currently reachable, or today&apos;s request
              allowance is spent.
            </Notice>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <Panel>
              <PanelHeader
                title="Latest headlines"
                description={`${result.articles.length} article${
                  result.articles.length === 1 ? "" : "s"
                }${result.cached ? " · served from cache" : ""}`}
              />
              <NewsList
                articles={result.articles}
                tickerHrefPrefix="/student/market"
                emptyTitle="No articles for this selection."
                emptyDescription={
                  tab === "for-you"
                    ? "None of the assets you hold or watch have fresh coverage right now."
                    : "No articles were returned for this topic. Try another tab or sort order."
                }
              />
            </Panel>

            <div className="space-y-5">
              <SentimentPanel
                distribution={result.sentiment}
                fetchedAt={result.fetchedAt}
                description={`Across the ${result.sentiment.total} articles returned for this tab.`}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
