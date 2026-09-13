import { ChartLine, Receipt, Wallet } from "lucide-react";
import Link from "next/link";

import { HoldingsTable } from "@/components/data/holdings-table";
import { LeaderboardMini } from "@/components/data/leaderboard-table";
import { PerformancePanel } from "@/components/data/performance-panel";
import { PortfolioSummary } from "@/components/data/portfolio-summary";
import { TransactionTable } from "@/components/data/transaction-table";
import { AssetSearch } from "@/components/market/asset-search";
import { WatchlistCard } from "@/components/market/watchlist-panel";
import { RequestFundsCard } from "@/components/student/request-funds-card";
import { refreshStudentMarketAction } from "@/lib/actions/market";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Notice,
  Panel,
  PanelHeader,
} from "@/components/ui/primitives";
import { getStudentWorkspace } from "@/lib/auth/context";
import {
  loadFundRequests,
  loadHeldSymbols,
  loadLeaderboard,
  loadPortfolio,
  loadPriceFreshness,
  loadSnapshots,
  loadTradeHistory,
  loadWatchlist,
} from "@/lib/data/queries";
import { getQuotes } from "@/lib/market/service";

export default async function StudentDashboardPage() {
  const { classroom, settings, session } = await getStudentWorkspace();
  if (!classroom) return null;

  // Refresh before reading the portfolio, so the figures on screen are the ones
  // derived from current prices rather than the last render's.
  const freshness = await loadPriceFreshness();
  const heldSymbols = await loadHeldSymbols(classroom.id);
  if (freshness.stale && heldSymbols.length > 0) {
    await getQuotes(heldSymbols);
  }

  const [portfolio, snapshots, trades, watchlist, leaderboard, fundRequests] =
    await Promise.all([
      loadPortfolio(classroom.id, session.userId),
      loadSnapshots(classroom.id, session.userId, 400),
      loadTradeHistory({ classroomId: classroom.id, studentId: session.userId, limit: 6 }),
      loadWatchlist(classroom.id, session.userId),
      loadLeaderboard(classroom.id),
      loadFundRequests({ classroomId: classroom.id, studentId: session.userId, limit: 10 }),
    ]);

  if (!portfolio) return null;

  const watchQuotes = watchlist.length
    ? (await getQuotes(watchlist.map((entry) => entry.asset.symbol))).quotes
    : new Map();

  const myRank = leaderboard.find((row) => row.studentId === session.userId);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title font-medium text-ink">
              {session.profile.fullName || "Your portfolio"}
            </h1>
            {myRank ? (
              <Badge tone={myRank.rank === 1 ? "brand" : "neutral"}>
                Rank {myRank.rank} of {leaderboard.length}
              </Badge>
            ) : null}
            <Badge tone={settings?.tradingEnabled ? "pos" : "warn"}>
              {settings?.tradingEnabled ? "Trading open" : "Trading paused"}
            </Badge>
          </div>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            {classroom.name}
            {classroom.section ? ` · ${classroom.section}` : ""} · all balances are
            virtual
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={refreshStudentMarketAction}>
            <input type="hidden" name="classroomId" value={classroom.id} />
            <Button type="submit" size="sm" variant="secondary">
              Refresh prices
            </Button>
          </form>
          <Button asChild size="sm" variant="primary">
            <Link href="/student/market">Trade</Link>
          </Button>
        </div>
      </header>

      {!settings?.tradingEnabled ? (
        <Notice tone="warn">
          {settings?.pausedReason?.trim() || "Trading is currently paused by your teacher."}
        </Notice>
      ) : null}

      <Panel className="px-5 py-4">
        <PortfolioSummary portfolio={portfolio} />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <PerformancePanel
            snapshots={snapshots}
            initialCapital={portfolio.initialCapital}
            refreshAction={
              <form action={refreshStudentMarketAction}>
                <input type="hidden" name="classroomId" value={classroom.id} />
                <Button type="submit" size="sm" variant="secondary">
                  Record Value
                </Button>
              </form>
            }
          />

          <Panel>
            <PanelHeader
              title="Your Investments"
              description="What you own right now, valued at the latest recorded price."
              action={
                <Button asChild size="sm" variant="ghost">
                  <Link href="/student/holdings">
                    <Wallet />
                    Details
                  </Link>
                </Button>
              }
            />
            <HoldingsTable
              holdings={portfolio.holdings}
              assetHrefPrefix="/student/market"
            />
          </Panel>

          <Panel>
            <PanelHeader
              title="Recent Trades"
              action={
                <Button asChild size="sm" variant="ghost">
                  <Link href="/student/activity">
                    <Receipt />
                    All activity
                  </Link>
                </Button>
              }
            />
            <TransactionTable trades={trades} />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="p-4">
            <h2 className="mb-3 text-[13px] font-medium text-ink">
              Find something to buy
            </h2>
            <AssetSearch classroomId={classroom.id} />
            <p className="mt-3 text-[12px] leading-relaxed text-ink-tertiary">
              Search US stocks and major crypto pairs. Prices come straight from
              our live market data source.
            </p>
          </Panel>

          <WatchlistCard
            classroomId={classroom.id}
            entries={watchlist}
            quotes={watchQuotes}
          />

          <RequestFundsCard
            classroomId={classroom.id}
            cashBalance={portfolio.cashBalance}
            requests={fundRequests}
          />

          <Panel>
            <PanelHeader
              title="Class leaderboard"
              action={
                <Button asChild size="sm" variant="ghost">
                  <Link href="/student/leaderboard">
                    <ChartLine />
                    Full table
                  </Link>
                </Button>
              }
            />
            <LeaderboardMini
              rows={leaderboard}
              highlightStudentId={session.userId}
              limit={5}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
