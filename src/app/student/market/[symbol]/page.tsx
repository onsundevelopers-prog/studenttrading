import { ArrowLeft, ChartLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AssetMark, PriceChange } from "@/components/data/atoms";
import { PriceChart } from "@/components/data/charts";
import { NewsList } from "@/components/news/news-list";
import { SentimentPanel } from "@/components/news/sentiment-panel";
import { CancelOrderButton } from "@/components/market/cancel-order-button";
import { PriceChartPanel } from "@/components/market/price-chart-panel";
import { TransactionTable } from "@/components/data/transaction-table";
import { TradePanel } from "@/components/market/trade-panel";
import { AddToWatchlistButton } from "@/components/market/watchlist-panel";
import { Button } from "@/components/ui/button";
import {
  Badge,
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui/primitives";
import { getStudentWorkspace } from "@/lib/auth/context";
import {
  isAssetPermitted,
  loadAssetById,
  loadClassroomSettings,
  loadOpenOrders,
  loadPortfolio,
  loadPriceHistoryForAssets,
  loadTradeHistory,
  loadWatchlist,
} from "@/lib/data/queries";
import { ensureAsset, getChartBars, getQuote } from "@/lib/market/service";
import { DEFAULT_CHART_RANGE, isChartRange } from "@/lib/market/ranges";
import { getMarketStatusFor } from "@/lib/market/market-status";
import {
  getCompanyOverview,
  getTickerNews,
  isNewsSort,
  NEWS_SORTS,
  type NewsSort,
} from "@/lib/news/service";
import {
  formatCompactMoney,
  formatDateTime,
  formatMoney,
  formatPrice,
  formatSignedMoney,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/** The detail view's sections. Tab state lives in the URL so it is server-driven. */
const ASSET_TABS = [
  { key: "chart", label: "Chart" },
  { key: "news", label: "News" },
  { key: "fundamentals", label: "Fundamentals" },
] as const;

type AssetTab = (typeof ASSET_TABS)[number]["key"];

/**
 * Order types are kept as trading terms — a student should learn them — but
 * they are written out here rather than shown as raw machine values.
 */
const ORDER_TYPE_NAMES: Record<string, string> = {
  market: "Market Order",
  limit: "Limit Order",
  stop: "Stop Order",
  stop_limit: "Stop-Limit Order",
};

/**
 * Asset detail plus the order ticket.
 *
 * The symbol may come from the search box, so it is registered as a real asset
 * here (server-side, with its name taken from the provider) before anything can
 * be traded against it.
 */
/** The News tab: the ticker's own coverage plus its sentiment distribution. */
function NewsTabBody({
  result,
  sort,
  sortHref,
  symbol,
}: {
  result: Awaited<ReturnType<typeof getTickerNews>> | null;
  sort: NewsSort;
  sortHref: (next: NewsSort) => string;
  symbol: string;
}) {
  if (!result) return null;

  if (!result.ok) {
    return (
      <div className="space-y-2">
        <Notice tone="warn">{result.reason}</Notice>
        {result.code === "budget" ? (
          <p className="text-[11px] leading-relaxed text-ink-tertiary">
            This classroom shares one free news allowance of 25 requests a day.
            It has been used up, so no {symbol} coverage can be fetched until it
            resets. Nothing is generated to fill the gap.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title={`${symbol} news`}
          description={
            result.articles.length > 0
              ? `Articles tagged with ${symbol}. Coverage that only mentions the ticker is left out.`
              : undefined
          }
          action={
            <div
              className="flex items-center gap-0.5 rounded-md border border-hairline bg-surface-2 p-0.5"
              role="group"
              aria-label="Sort news"
            >
              {NEWS_SORTS.map((option) => (
                <Link
                  key={option.key}
                  href={sortHref(option.key)}
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
          }
        />
        <NewsList
          articles={result.articles}
          emptyTitle={`No ${symbol} news right now.`}
          emptyDescription={`No articles tagged with ${symbol} were returned for the current selection. Nothing is shown in their place.`}
        />
      </Panel>

      <SentimentPanel
        distribution={result.sentiment}
        fetchedAt={result.fetchedAt}
        title={`${symbol} news sentiment`}
        description={`Across the ${result.sentiment.total} articles returned for ${symbol}.`}
      />
    </div>
  );
}

function FundamentalsRow({
  label,
  hint,
  children,
}: {
  label: string;
  /** Plain-language explanation of a financial term, shown on hover. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-b-0">
      <dt
        className={cn(
          "text-[12px] text-ink-tertiary",
          hint &&
            "cursor-help underline decoration-dotted decoration-hairline-strong underline-offset-2",
        )}
        title={hint}
      >
        {label}
      </dt>
      <dd className="num max-w-[62%] text-right text-[12.5px] text-ink">{children}</dd>
    </div>
  );
}

/** Percentage figures arrive as fractions (0.0032 → 0.32%). */
function asPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * The Fundamentals tab.
 *
 * Everything here is provider data, fetched once per symbol per day and cached.
 * Where the provider has no figure the row says so rather than showing a zero.
 */
function FundamentalsTabBody({
  result,
  assetName,
  assetType,
  exchange,
  currency,
  lastPrice,
}: {
  result: Awaited<ReturnType<typeof getCompanyOverview>> | null;
  assetName: string;
  assetType: "stock" | "crypto";
  exchange: string | null;
  currency: string;
  lastPrice: number | null;
}) {
  if (!result) return null;

  if (!result.ok) {
    return (
      <Panel className="p-4">
        <h2 className="text-[13px] font-medium text-ink">Fundamentals</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-tertiary">
          {result.reason}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-tertiary">
          Company information comes from Alpha Vantage and is kept for a day.
          {assetType === "crypto"
            ? " Company information like this is not published for crypto pairs."
            : " Nothing is estimated in its place."}
        </p>
      </Panel>
    );
  }

  const { overview } = result;
  const range =
    overview.week52High !== null && overview.week52Low !== null
      ? overview.week52High - overview.week52Low
      : 0;
  const positionPercent =
    lastPrice !== null && range > 0
      ? Math.min(
          100,
          Math.max(0, ((lastPrice - (overview.week52Low ?? 0)) / range) * 100),
        )
      : null;

  return (
    <div className="space-y-5">
      <Panel className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-medium text-ink">
            About the company
          </h2>
          <span className="text-[11px] text-ink-tertiary">
            {result.stale ? "cached" : "Alpha Vantage"} · {formatDateTime(result.fetchedAt)}
          </span>
        </div>
        <dl className="mt-2">
          <FundamentalsRow label="Name">{overview.name ?? assetName}</FundamentalsRow>
          <FundamentalsRow label="Exchange">
            {overview.exchange ?? exchange ?? "—"}
          </FundamentalsRow>
          <FundamentalsRow label="Sector">{overview.sector ?? "—"}</FundamentalsRow>
          <FundamentalsRow label="Industry">{overview.industry ?? "—"}</FundamentalsRow>
          <FundamentalsRow label="Country">{overview.country ?? "—"}</FundamentalsRow>
          <FundamentalsRow label="Currency">
            {overview.currency ?? currency}
          </FundamentalsRow>
          <FundamentalsRow
            label="Market Value"
            hint="The total value of the company on the market: its share price multiplied by all of its shares."
          >
            {overview.marketCap === null
              ? "—"
              : formatCompactMoney(overview.marketCap)}
          </FundamentalsRow>
          <FundamentalsRow
            label="Shares Outstanding"
            hint="How many shares of the company exist in total."
          >
            {overview.sharesOutstanding === null
              ? "—"
              : formatCompactMoney(overview.sharesOutstanding).replace("$", "")}
          </FundamentalsRow>
          <FundamentalsRow
            label="Price-to-Earnings Ratio"
            hint="How many dollars investors pay for each dollar of yearly profit the company makes."
          >
            {overview.peRatio === null ? "—" : overview.peRatio.toFixed(2)}
          </FundamentalsRow>
          <FundamentalsRow
            label="Price/Earnings-to-Growth Ratio"
            hint="The price-to-earnings ratio adjusted for how quickly the company is expected to grow."
          >
            {overview.pegRatio === null ? "—" : overview.pegRatio.toFixed(2)}
          </FundamentalsRow>
          <FundamentalsRow
            label="Dividend Yield"
            hint="The yearly cash payments a company makes to its shareholders, shown as a percentage of its share price."
          >
            {asPercent(overview.dividendYield)}
          </FundamentalsRow>
          <FundamentalsRow
            label="Profit Margin"
            hint="How much of each dollar of sales the company keeps as profit."
          >
            {asPercent(overview.profitMargin)}
          </FundamentalsRow>
        </dl>
      </Panel>

      <Panel className="p-4">
        <h2 className="text-[13px] font-medium text-ink">52-Week Price Range</h2>
        <p className="mt-1 text-[12px] leading-snug text-ink-tertiary">
          The lowest and highest price this investment has traded at over the
          last 52 weeks, with the current price marked between them.
        </p>
        {overview.week52High === null || overview.week52Low === null ? (
          <p className="mt-2 text-[12px] text-ink-tertiary">
            The provider has no 52-week price range for this symbol.
          </p>
        ) : (
          <>
            <div className="mt-3 flex items-baseline justify-between text-[12px]">
              <span className="num text-ink-muted">
                {formatPrice(overview.week52Low, "stock")}
              </span>
              <span className="num text-ink">
                {lastPrice === null ? "—" : formatPrice(lastPrice, "stock")}
              </span>
              <span className="num text-ink-muted">
                {formatPrice(overview.week52High, "stock")}
              </span>
            </div>
            <div className="relative mt-2 h-1.5 w-full rounded-full bg-surface-3">
              {positionPercent !== null ? (
                <span
                  className="absolute -top-1 h-3.5 w-[2px] rounded-full bg-ink"
                  style={{ left: `calc(${positionPercent}% - 1px)` }}
                  aria-hidden
                />
              ) : null}
            </div>
            <p className="mt-2 text-[11px] text-ink-tertiary">
              {positionPercent === null
                ? "The current price is unavailable, so its position in the range cannot be shown."
                : `The current price sits at ${positionPercent.toFixed(0)}% of the 52-week range.`}
            </p>
          </>
        )}
      </Panel>

      {overview.description ? (
        <Panel className="p-4">
          <h2 className="text-[13px] font-medium text-ink">About {overview.name}</h2>
          <p className="mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-subtle">
            {overview.description}
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-tertiary">
            Company description supplied by Alpha Vantage. It is shown exactly as
            provided and is not edited by this application.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ range?: string; tab?: string; sort?: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol);

  // Both the chart range and the open tab live in the URL, because both decide
  // what is fetched from a provider — that is a server concern, not client state.
  const { range: rawRange, tab: rawTab, sort: rawSort } = await searchParams;
  const range = isChartRange(rawRange) ? rawRange : DEFAULT_CHART_RANGE;
  const tab: AssetTab = ASSET_TABS.some((candidate) => candidate.key === rawTab)
    ? (rawTab as AssetTab)
    : "chart";
  const newsSort: NewsSort = isNewsSort(rawSort) ? rawSort : "latest";

  const { classroom, session } = await getStudentWorkspace();
  if (!classroom) return null;

  const ensured = await ensureAsset(symbol);
  if (!ensured.ok) notFound();

  const [asset, quoteResult, portfolio, settings, watchlist] = await Promise.all([
    loadAssetById(ensured.assetId),
    getQuote(symbol),
    loadPortfolio(classroom.id, session.userId),
    loadClassroomSettings(classroom.id),
    loadWatchlist(classroom.id, session.userId),
  ]);

  if (!asset || !portfolio) notFound();

  const [history, trades, permitted, bars, openOrders, marketStatus, newsResult, overviewResult] =
    await Promise.all([
      loadPriceHistoryForAssets([asset.id], 24 * 14),
      loadTradeHistory({ classroomId: classroom.id, studentId: session.userId, limit: 12 }),
      isAssetPermitted(classroom.id, asset.symbol),
      getChartBars(asset.symbol, range, asset.assetType),
      loadOpenOrders(classroom.id, session.userId),
      getMarketStatusFor(asset.assetType),
      // News and fundamentals are only fetched when their tab is actually open.
      // Alpha Vantage allows one request per second and 25 per day for the whole
      // classroom, so merely looking at a quote must never cost a request.
      tab === "news"
        ? getTickerNews(asset.symbol, { sort: newsSort, limit: 25 })
        : Promise.resolve(null),
      tab === "fundamentals"
        ? getCompanyOverview(asset.symbol)
        : Promise.resolve(null),
    ]);

  const points = history.get(asset.id) ?? [];
  const quote = quoteResult.ok ? quoteResult.quote : null;
  const holding = portfolio.holdings.find((item) => item.assetId === asset.id);
  const assetTrades = trades.filter((trade) => trade.symbol === asset.symbol);
  const assetOpenOrders = openOrders.filter((order) => order.symbol === asset.symbol);
  // Real provider history renders when available; otherwise the sampled series
  // is shown with its existing honest empty state.
  const chartBars = bars.length >= 2 ? bars : null;
  const assetHref = `/student/market/${encodeURIComponent(asset.symbol)}`;

  function tabHref(nextTab: AssetTab, nextSort?: NewsSort) {
    const search = new URLSearchParams();
    search.set("tab", nextTab);
    if (range !== DEFAULT_CHART_RANGE) search.set("range", range);
    const sort = nextSort ?? newsSort;
    if (nextTab === "news" && sort !== "latest") search.set("sort", sort);
    return `${assetHref}?${search.toString()}`;
  }

  return (
    <div className="space-y-5">
      <div>
        <Button asChild size="sm" variant="ghost" className="-ml-2">
          <Link href="/student/market">
            <ArrowLeft />
            Market
          </Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="pt-1">
            <AssetMark
              symbol={asset.displaySymbol}
              assetType={asset.assetType}
              className="h-10 min-w-[72px] text-[13px]"
            />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-title font-medium text-ink">{asset.name}</h1>
              <Badge tone="outline">
                {asset.assetType === "crypto" ? "Crypto" : "Stock"}
              </Badge>
              {asset.exchange ? (
                <span className="text-[12px] text-ink-tertiary">{asset.exchange}</span>
              ) : null}
            </div>
            <p className="mt-1 font-mono text-[12px] text-ink-tertiary">
              {asset.symbol}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right">
            {quote ? (
              <>
                <p className="num text-[26px] font-medium leading-none text-ink">
                  {formatPrice(quote.price, asset.assetType)}
                </p>
                <p className="mt-1.5 flex items-center justify-end gap-2">
                  <PriceChange
                    percent={quote.changePercent}
                    change={quote.change}
                  />
                  {quote.stale ? <Badge tone="warn">Out of date</Badge> : null}
                </p>
              </>
            ) : (
              <p className="max-w-[220px] text-right text-[12px] leading-relaxed text-warn">
              {quoteResult.ok ? "No price available right now." : quoteResult.reason}
            </p>
          )}
        </div>
          <AddToWatchlistButton
            classroomId={classroom.id}
            symbol={asset.symbol}
            alreadyWatched={watchlist.some((entry) => entry.asset.id === asset.id)}
          />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1 border-b border-hairline">
        {ASSET_TABS.map((candidate) => (
          <Link
            key={candidate.key}
            href={tabHref(candidate.key)}
            scroll={false}
            aria-current={candidate.key === tab}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors",
              candidate.key === tab
                ? "border-brand text-ink"
                : "border-transparent text-ink-tertiary hover:text-ink-muted",
            )}
          >
            {candidate.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {tab === "chart" ? (
          <>
          <Panel>
            <PanelHeader
              title={`Price history · ${range === "MAX" ? "Max" : range}`}
              description={
                chartBars
                  ? "Real price bars from our market data source. Hover over the chart to see the open, high, low and closing price for each period."
                  : "Recorded by this simulator. No price bars were returned for this range, so this series is what has actually been observed."
              }
            />
            <PanelBody>
              {chartBars ? (
                <PriceChartPanel
                  symbol={asset.symbol}
                  assetType={asset.assetType}
                  bars={chartBars}
                  range={range}
                  rangeHref={(next) => `${assetHref}?range=${next}`}
                />
              ) : points.length >= 2 ? (
                <PriceChart points={points} assetType={asset.assetType} />
              ) : (
                <EmptyState
                  icon={<ChartLine className="size-5" />}
                  title={
                    points.length === 1
                      ? "Only one price recorded so far."
                      : "No prices recorded yet."
                  }
                  description="A chart is only drawn from prices this simulator has actually recorded. Prices are checked every few minutes while it is running, and the chart fills in from there."
                />
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Your trades in this investment"
              description={
                holding
                  ? `You own ${holding.quantity} at an average price of ${formatPrice(holding.avgCost, asset.assetType)}.`
                  : "You don't own this investment yet."
              }
            />
            <TransactionTable
              trades={assetTrades}
              emptyTitle="You haven't traded this investment yet."
              emptyDescription="Use the order form to place your first simulated trade."
            />
          </Panel>
          </>
          ) : tab === "news" ? (
            <NewsTabBody
              result={newsResult}
              sort={newsSort}
              sortHref={(next) => tabHref("news", next)}
              symbol={asset.symbol}
            />
          ) : (
            <FundamentalsTabBody
              result={overviewResult}
              assetName={asset.name}
              assetType={asset.assetType}
              exchange={asset.exchange}
              currency={asset.currency}
              lastPrice={quote?.price ?? null}
            />
          )}
        </div>

        <div className="space-y-5">
          <Panel className="p-4">
            <h2 className="mb-4 text-[13px] font-medium text-ink">Place an Order</h2>
            <TradePanel
              classroomId={classroom.id}
              symbol={asset.symbol}
              displaySymbol={asset.displaySymbol}
              assetType={asset.assetType}
              price={quote?.price ?? null}
              priceStale={quote === null || quote.stale}
              cashBalance={portfolio.cashBalance}
              holdingQuantity={holding?.quantity ?? 0}
              permitted={permitted && (settings?.assetPolicy !== "allowlist" || permitted)}
              tradingEnabled={settings?.tradingEnabled ?? false}
              pausedReason={settings?.pausedReason ?? null}
              allowFractional={settings?.allowFractional ?? true}
              maxTradeValue={settings?.maxTradeValue ?? null}
              maxPositionPercent={settings?.maxPositionPercent ?? null}
              allowedOrderTypes={settings?.allowedOrderTypes ?? ["market"]}
              marketOpen={marketStatus.tradingAllowed || !settings?.enforceMarketHours}
            />

            {assetOpenOrders.length > 0 ? (
              <Panel>
                <PanelHeader
                  title="Orders Waiting to Complete"
                  description="Waiting until the market reaches your price. You can cancel one at any time."
                />
                <PanelBody className="space-y-2">
                  {assetOpenOrders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between rounded-md border border-hairline bg-surface-2 px-3 py-2 text-[12px]"
                    >
                      <div>
                        <span className="font-medium text-ink">
                          {order.side === "buy" ? "Buy" : "Sell"}{" "}
                          {ORDER_TYPE_NAMES[order.orderType] ?? "Order"}
                        </span>
                        <span className="num ml-2 text-ink-muted">
                          {order.quantity} at{" "}
                          {formatPrice(order.limitPrice ?? order.stopPrice ?? order.price, asset.assetType)}
                        </span>
                        {order.filledQuantity > 0 && order.filledQuantity < order.quantity ? (
                          <span className="num ml-2 text-warn">
                            {order.filledQuantity} completed so far
                          </span>
                        ) : null}
                      </div>
                      <CancelOrderButton orderId={order.id} />
                    </div>
                  ))}
                </PanelBody>
              </Panel>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader
              title="Your Investment"
              description="What you own in this investment right now."
            />
            <PanelBody className="space-y-2 text-[12px]">
              <div className="flex justify-between gap-3">
                <span className="text-ink-tertiary">Shares You Own</span>
                <span className="num text-ink-muted">
                  {holding ? holding.quantity : 0}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span
                  className="text-ink-tertiary"
                  title="The average price you paid for everything you own, allowing for anything you have already sold."
                >
                  Average Price
                </span>
                <span className="num text-ink-muted">
                  {holding
                    ? formatPrice(holding.avgCost, asset.assetType)
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-tertiary">Market Value</span>
                <span className="num text-ink-muted">
                  {holding ? formatMoney(holding.marketValue) : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span
                  className="text-ink-tertiary"
                  title="Profit or loss you locked in when you sold part of this investment."
                >
                  Profit/Loss from Sold Investments
                </span>
                <span className="num text-ink-muted">
                  {holding ? formatSignedMoney(holding.realizedPnl) : "—"}
                </span>
              </div>
            </PanelBody>
          </Panel>

          {quote?.stale ? (
            <Notice tone="warn">
              We couldn&apos;t reach the market data provider, so the last known
              price is shown. Trading is paused until a current price is
              available.
            </Notice>
          ) : null}
        </div>
      </div>
    </div>
  );
}
