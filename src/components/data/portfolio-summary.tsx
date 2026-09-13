import { MetricTile, NotAvailable, PercentCell, PriceChange } from "@/components/data/atoms";
import { Notice } from "@/components/ui/primitives";
import { formatMoney, formatPercent, formatSignedMoney } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

/**
 * Headline portfolio figures.
 *
 * "Today's P/L" is only shown when a baseline snapshot actually exists. When it
 * does not, the tile says why instead of quietly showing the since-inception
 * number under a "today" label.
 */
export function PortfolioSummary({ portfolio }: { portfolio: Portfolio }) {
  const hasToday = portfolio.todayPnl !== null && portfolio.todayBasisKind !== "none";

  const todayHint = !hasToday
    ? "Recorded once a prior day's snapshot exists."
    : portfolio.todayBasisKind === "prior_close"
      ? `Since yesterday's close (${new Date(portfolio.todayBasisAt ?? "").toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
      : "Since the first recorded snapshot.";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3 xl:grid-cols-5">
        <MetricTile
          label="Portfolio value"
          value={formatMoney(portfolio.totalValue)}
          size="lg"
          aside={
            <PercentCell
              value={portfolio.totalPnlPercent}
              className="text-[13px]"
            />
          }
          hint={`Cash ${formatMoney(portfolio.cashBalance)} · Positions ${formatMoney(portfolio.holdingsMarketValue)}`}
        />

        <MetricTile
          label="Today's P/L"
          tone={hasToday ? portfolio.todayPnl : undefined}
          value={
            hasToday ? (
              formatSignedMoney(portfolio.todayPnl)
            ) : (
              <NotAvailable reason={todayHint} />
            )
          }
          aside={
            hasToday && portfolio.todayPnlPercent !== null ? (
              <span className="num text-[13px] text-ink-subtle">
                {formatPercent(portfolio.todayPnlPercent, { signed: true })}
              </span>
            ) : null
          }
          hint={todayHint}
        />

        <MetricTile
          label="Total P/L"
          tone={portfolio.totalPnl}
          value={formatSignedMoney(portfolio.totalPnl)}
          aside={
            <span className="text-[12px] text-ink-tertiary">
              vs {formatMoney(portfolio.initialCapital)} start
            </span>
          }
          hint={
            <span className="flex flex-wrap gap-x-2">
              <span>
                Realised{" "}
                <span className="num text-ink-subtle">
                  {formatSignedMoney(portfolio.realizedPnl)}
                </span>
              </span>
              <span>
                Unrealised{" "}
                <span className="num text-ink-subtle">
                  {formatSignedMoney(portfolio.unrealizedPnl)}
                </span>
              </span>
            </span>
          }
        />

        <MetricTile
          label="Cash available"
          value={formatMoney(portfolio.cashBalance)}
          hint={
            portfolio.initialCapital > 0
              ? `${formatPercent((portfolio.cashBalance / portfolio.initialCapital) * 100, { digits: 0 })} of starting capital`
              : undefined
          }
        />

        <MetricTile
          label="Trades placed"
          value={portfolio.tradeCount}
          hint={
            portfolio.lastTradeAt
              ? `Last ${new Date(portfolio.lastTradeAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : "No trades yet"
          }
          aside={
            <PriceChange
              percent={portfolio.totalPnlPercent}
              showArrow={false}
              size="sm"
            />
          }
        />
      </div>

      {portfolio.pricesIncomplete ? (
        <Notice tone="warn">
          Some holdings have no sampled price yet, so their cost basis is being
          used and the figures above understate or overstate the true value. Open
          the asset to trigger a price fetch.
        </Notice>
      ) : null}
    </div>
  );
}
