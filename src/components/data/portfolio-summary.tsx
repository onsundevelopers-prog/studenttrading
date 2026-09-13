import { MetricTile, NotAvailable, PercentCell, PriceChange } from "@/components/data/atoms";
import { Notice } from "@/components/ui/primitives";
import { formatMoney, formatPercent, formatSignedMoney } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

/**
 * Headline portfolio figures.
 *
 * "Today's Profit and Loss" is only shown when a baseline snapshot actually
 * exists. When it does not, the tile says why instead of quietly showing the
 * since-inception number under a "today" label.
 */
export function PortfolioSummary({ portfolio }: { portfolio: Portfolio }) {
  const hasToday = portfolio.todayPnl !== null && portfolio.todayBasisKind !== "none";

  const todayHint = !hasToday
    ? "Shown once a previous day's portfolio value has been recorded."
    : portfolio.todayBasisKind === "prior_close"
      ? `Compared with yesterday's closing value (${new Date(portfolio.todayBasisAt ?? "").toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
      : "Compared with the first value recorded for this portfolio.";

  /**
   * Once the sign is known, "Today's Profit" or "Today's Loss" says more than
   * the general term does — the label now matches the number beside it.
   */
  const todayLabel =
    hasToday && portfolio.todayPnl !== null && portfolio.todayPnl !== 0
      ? portfolio.todayPnl > 0
        ? "Today's Profit"
        : "Today's Loss"
      : "Today's Profit and Loss";

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
          hint={`Available cash ${formatMoney(portfolio.cashBalance)} · Investments worth ${formatMoney(portfolio.holdingsMarketValue)}`}
        />

        <MetricTile
          label={todayLabel}
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
          label="Total Profit and Loss"
          tone={portfolio.totalPnl}
          value={formatSignedMoney(portfolio.totalPnl)}
          aside={
            <span className="text-[12px] text-ink-tertiary">
              starting with {formatMoney(portfolio.initialCapital)}
            </span>
          }
          hint={
            <span className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span title="Profit or loss you locked in when you sold an investment">
                Profit/Loss from Sold Investments{" "}
                <span className="num text-ink-subtle">
                  {formatSignedMoney(portfolio.realizedPnl)}
                </span>
              </span>
              <span title="Profit or loss you would make if you sold your investments at the current price">
                Potential Profit/Loss{" "}
                <span className="num text-ink-subtle">
                  {formatSignedMoney(portfolio.unrealizedPnl)}
                </span>
              </span>
            </span>
          }
        />

        <MetricTile
          label="Available Cash"
          value={formatMoney(portfolio.cashBalance)}
          tooltip="Money you currently have available to invest."
          hint={
            portfolio.initialCapital > 0
              ? `${formatPercent((portfolio.cashBalance / portfolio.initialCapital) * 100, { digits: 0 })} of the money you started with`
              : undefined
          }
        />

        <MetricTile
          label="Trades Placed"
          value={portfolio.tradeCount}
          hint={
            portfolio.lastTradeAt
              ? `Last trade ${new Date(portfolio.lastTradeAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : "You haven't traded yet"
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
          Some of your investments don&apos;t have a current price yet, so the
          price you paid for them is being used instead. That can make the figures
          above too high or too low. Open the investment to fetch its latest
          price.
        </Notice>
      ) : null}
    </div>
  );
}
