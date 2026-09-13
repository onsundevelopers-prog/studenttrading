import { ArrowLeft, ChartLine } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AssetMark, PriceChange } from "@/components/data/atoms";
import { PriceChart } from "@/components/data/charts";
import { BarChartPanel, VolumeChart } from "@/components/market/bar-chart-panel";
import { CancelOrderButton } from "@/components/market/cancel-order-button";
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
import { getStudentWorkspace } from "@/lib/auth/context";import {
  isAssetPermitted,
  loadAssetById,
  loadClassroomSettings,
  loadOpenOrders,
  loadPortfolio,
  loadPriceHistoryForAssets,
  loadTradeHistory,
  loadWatchlist,
} from "@/lib/data/queries";
import { getHistoricalBars, ensureAsset, getQuote } from "@/lib/market/service";
import { getMarketStatusFor } from "@/lib/market/market-status";
import { formatPrice } from "@/lib/format";

/**
 * Asset detail plus the order ticket.
 *
 * The symbol may come from the search box, so it is registered as a real asset
 * here (server-side, with its name taken from the provider) before anything can
 * be traded against it.
 */
export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol);

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

  const [history, trades, permitted, bars, openOrders, marketStatus] = await Promise.all([
    loadPriceHistoryForAssets([asset.id], 24 * 14),
    loadTradeHistory({ classroomId: classroom.id, studentId: session.userId, limit: 12 }),
    isAssetPermitted(classroom.id, asset.symbol),
    getHistoricalBars(asset.symbol, { days: 365 }),
    loadOpenOrders(classroom.id, session.userId),
    getMarketStatusFor(asset.assetType),
  ]);

  const points = history.get(asset.id) ?? [];
  const quote = quoteResult.ok ? quoteResult.quote : null;
  const holding = portfolio.holdings.find((item) => item.assetId === asset.id);
  const assetTrades = trades.filter((trade) => trade.symbol === asset.symbol);
  const assetOpenOrders = openOrders.filter((order) => order.symbol === asset.symbol);
  // Real provider history renders when available; otherwise the sampled series
  // is shown with its existing honest empty state.
  const chartBars = bars.length >= 2 ? bars : null;

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
                  {quote.stale ? <Badge tone="warn">Stale</Badge> : null}
                </p>
              </>
            ) : (
              <p className="max-w-[220px] text-right text-[12px] leading-relaxed text-warn">
                {quoteResult.ok ? "No price available." : quoteResult.reason}
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

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel>
            <PanelHeader
              title={chartBars ? "Price history · 1Y daily" : "Price history"}
              description={
                chartBars
                  ? "Real daily candles from the market data provider."
                  : "Sampled by this simulator. Historical candles are unavailable for this symbol, so this series is what has actually been observed."
              }
            />
            <PanelBody>
              {chartBars ? (
                <BarChartPanel bars={chartBars} assetType={asset.assetType} />
              ) : points.length >= 2 ? (
                <PriceChart points={points} assetType={asset.assetType} />
              ) : (
                <EmptyState
                  icon={<ChartLine className="size-5" />}
                  title={
                    points.length === 1
                      ? "One price sample so far."
                      : "No price samples yet."
                  }
                  description="A line is only drawn from recorded points. Prices are sampled every few minutes while the simulator is open, and the chart fills in from there."
                />
              )}
            </PanelBody>
          </Panel>

          {chartBars ? (
            <Panel>
              <PanelHeader title="Volume" description="Shares or units traded per day, from the provider." />
              <PanelBody>
                <VolumeChart bars={chartBars} />
              </PanelBody>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              title="Your trades in this asset"
              description={
                holding
                  ? `You hold ${holding.quantity} at an average cost of ${formatPrice(holding.avgCost, asset.assetType)}.`
                  : "You do not hold this asset."
              }
            />
            <TransactionTable
              trades={assetTrades}
              emptyTitle="You have not traded this asset yet."
              emptyDescription="Use the order ticket to place your first simulated trade."
            />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="p-4">
            <h2 className="mb-4 text-[13px] font-medium text-ink">Place an order</h2>
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
                <PanelHeader title="Working orders" description="Resting until your price is reached, or cancelled. Cancellation is immediate." />
                <PanelBody className="space-y-2">
                  {assetOpenOrders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between rounded-md border border-hairline bg-surface-2 px-3 py-2 text-[12px]"
                    >
                      <div>
                        <span className="font-medium capitalize text-ink">
                          {order.side} {order.orderType.replace("_", "-")}
                        </span>
                        <span className="num ml-2 text-ink-muted">
                          {order.quantity} @ {formatPrice(order.limitPrice ?? order.stopPrice ?? order.price, asset.assetType)}
                        </span>
                        {order.filledQuantity > 0 && order.filledQuantity < order.quantity ? (
                          <span className="num ml-2 text-warn">
                            {order.filledQuantity} filled
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
            <PanelHeader title="Position" />
            <PanelBody className="space-y-2 text-[12px]">
              <div className="flex justify-between">
                <span className="text-ink-tertiary">Quantity held</span>
                <span className="num text-ink-muted">
                  {holding ? holding.quantity : 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-tertiary">Average cost</span>
                <span className="num text-ink-muted">
                  {holding
                    ? formatPrice(holding.avgCost, asset.assetType)
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-tertiary">Market value</span>
                <span className="num text-ink-muted">
                  {holding ? holding.marketValue.toFixed(2) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-tertiary">Realised P/L</span>
                <span className="num text-ink-muted">
                  {holding ? holding.realizedPnl.toFixed(2) : "—"}
                </span>
              </div>
            </PanelBody>
          </Panel>

          {quote?.stale ? (
            <Notice tone="warn">
              The provider could not be reached, so the last known price is shown
              and trading is blocked until a fresh price is available.
            </Notice>
          ) : null}
        </div>
      </div>
    </div>
  );
}
