import { MetricTile } from "@/components/data/atoms";
import { TransactionTable } from "@/components/data/transaction-table";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { getStudentWorkspace } from "@/lib/auth/context";
import { loadPortfolio, loadTradeHistory } from "@/lib/data/queries";
import { formatMoney, formatRelative, formatSignedMoney } from "@/lib/format";

export default async function StudentActivityPage() {
  const { classroom, session } = await getStudentWorkspace();
  if (!classroom) return null;

  const [trades, portfolio] = await Promise.all([
    loadTradeHistory({
      classroomId: classroom.id,
      studentId: session.userId,
      limit: 250,
    }),
    loadPortfolio(classroom.id, session.userId),
  ]);

  if (!portfolio) return null;

  const buys = trades.filter((trade) => trade.side === "buy").length;
  const sells = trades.length - buys;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-title font-medium text-ink">Your activity</h1>
        <p className="mt-1.5 text-[12px] text-ink-tertiary">
          Every order the engine accepted, newest first. This ledger is
          append-only — a trade is never edited or deleted.
        </p>
      </header>

      <Panel className="px-5 py-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <MetricTile label="Trades placed" value={portfolio.tradeCount} />
          <MetricTile
            label="Buys / sells"
            value={`${buys} / ${sells}`}
            hint={trades.length >= 250 ? "Showing the most recent 250" : undefined}
          />
          <MetricTile
            label="Realised P/L"
            tone={portfolio.realizedPnl}
            value={formatSignedMoney(portfolio.realizedPnl)}
            hint="Locked in by selling"
          />
          <MetricTile
            label="Last trade"
            value={
              <span className="text-[17px]">
                {portfolio.lastTradeAt ? formatRelative(portfolio.lastTradeAt) : "never"}
              </span>
            }
            hint={`Total portfolio ${formatMoney(portfolio.totalValue)}`}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Transaction history" />
        <TransactionTable
          trades={trades}
          emptyTitle="No trades yet."
          emptyDescription="Search the market to find an asset to trade — your buys and sells will be listed here."
        />
      </Panel>
    </div>
  );
}
