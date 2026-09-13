import Link from "next/link";

import { MetricTile } from "@/components/data/atoms";
import { TransactionTable } from "@/components/data/transaction-table";
import { CancelOrderButton } from "@/components/market/cancel-order-button";
import { Badge, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { getStudentWorkspace } from "@/lib/auth/context";
import {
  loadOpenOrders,
  loadPortfolio,
  loadTradeHistory,
} from "@/lib/data/queries";
import {
  formatDateTime,
  formatMoney,
  formatPrice,
  formatRelative,
  formatSignedMoney,
} from "@/lib/format";

/**
 * The trading terms are kept because they are what a broker would show, but
 * they are spelled out rather than abbreviated.
 */
const ORDER_TYPE_NAMES: Record<string, string> = {
  market: "Market Order",
  limit: "Limit Order",
  stop: "Stop Order",
  stop_limit: "Stop-Limit Order",
};

export default async function StudentActivityPage() {
  const { classroom, session } = await getStudentWorkspace();
  if (!classroom) return null;

  const [trades, portfolio, openOrders] = await Promise.all([
    loadTradeHistory({
      classroomId: classroom.id,
      studentId: session.userId,
      limit: 250,
    }),
    loadPortfolio(classroom.id, session.userId),
    loadOpenOrders(classroom.id, session.userId),
  ]);

  if (!portfolio) return null;

  const buys = trades.filter((trade) => trade.side === "buy").length;
  const sells = trades.length - buys;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-title font-medium text-ink">Your activity</h1>
        <p className="mt-1.5 text-[12px] text-ink-tertiary">
          Every order this simulator accepted, newest first. Once a trade is
          recorded it is never edited or deleted.
        </p>
      </header>

      <Panel className="px-5 py-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <MetricTile label="Trades Placed" value={portfolio.tradeCount} />
          <MetricTile
            label="Buys / Sells"
            value={`${buys} / ${sells}`}
            hint={trades.length >= 250 ? "Showing the most recent 250" : undefined}
          />
          <MetricTile
            label="Profit/Loss from Sold Investments"
            tone={portfolio.realizedPnl}
            value={formatSignedMoney(portfolio.realizedPnl)}
            tooltip="Profit or loss you locked in when you sold an investment."
            hint="Locked in when you sold"
          />
          <MetricTile
            label="Last Trade"
            value={
              <span className="text-[17px]">
                {portfolio.lastTradeAt ? formatRelative(portfolio.lastTradeAt) : "never"}
              </span>
            }
            hint={`Total portfolio value ${formatMoney(portfolio.totalValue)}`}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Orders Waiting to Complete"
          description="Orders you placed that are waiting for the market to reach your price. Cancelling is immediate and gives back any money or shares the order was holding."
          action={
            <Badge tone={openOrders.length > 0 ? "warn" : "neutral"}>
              {openOrders.length} waiting
            </Badge>
          }
        />
        {openOrders.length === 0 ? (
          <PanelBody>
            <p className="text-[12px] leading-relaxed text-ink-tertiary">
              You don&apos;t have any orders waiting to complete. Market orders
              complete straight away, so only limit, stop and stop-limit orders
              ever wait here.
            </p>
          </PanelBody>
        ) : (
          <PanelBody className="space-y-2">
            {openOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-hairline bg-surface-2 px-3 py-2 text-[12px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/student/market/${encodeURIComponent(order.symbol)}`}
                    className="font-mono text-[12px] font-medium text-ink hover:underline"
                  >
                    {order.displaySymbol}
                  </Link>
                  <Badge tone={order.side === "buy" ? "pos" : "neg"}>
                    {order.side === "buy" ? "Buy" : "Sell"}
                  </Badge>
                  <span className="text-ink-muted">
                    {ORDER_TYPE_NAMES[order.orderType]}
                  </span>
                  <span className="num text-ink-muted">
                    {order.quantity} at{" "}
                    {formatPrice(
                      order.limitPrice ?? order.stopPrice ?? order.price,
                      "stock",
                    )}
                  </span>
                  {order.filledQuantity > 0 ? (
                    <span className="num text-warn">
                      {order.filledQuantity} completed so far
                    </span>
                  ) : null}
                  <span className="text-ink-tertiary">
                    placed {formatDateTime(order.createdAt)}
                  </span>
                </div>
                <CancelOrderButton orderId={order.id} />
              </div>
            ))}
          </PanelBody>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Transaction History"
          description="Every buy and sell, with the price you paid or received."
        />
        <TransactionTable
          trades={trades}
          emptyTitle="You haven't made any trades yet."
          emptyDescription="Search the market for something to buy — your completed trades will be listed here."
        />
      </Panel>
    </div>
  );
}
