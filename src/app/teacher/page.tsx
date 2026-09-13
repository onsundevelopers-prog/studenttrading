import { Activity, Download, Users } from "lucide-react";
import Link from "next/link";

import { MetricTile } from "@/components/data/atoms";
import { TransactionTable } from "@/components/data/transaction-table";
import { StudentTable } from "@/components/teacher/student-table";
import { JoinCodeCard } from "@/components/teacher/join-code-card";
import { RefreshMarketButton } from "@/components/teacher/teacher-controls";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Notice,
  Panel,
  PanelHeader,
} from "@/components/ui/primitives";
import { getTeacherWorkspace } from "@/lib/auth/context";
import {
  loadClassOverview,
  loadDefaultStartingCapital,
  loadHeldSymbols,
  loadPriceFreshness,
  loadStudents,
  loadTradeHistory,
} from "@/lib/data/queries";
import { getQuotes } from "@/lib/market/service";
import { formatMoney, formatPercent, formatSignedMoney } from "@/lib/format";

export default async function TeacherOverviewPage() {
  const { classroom, settings } = await getTeacherWorkspace();
  if (!classroom) return null;

  // Only reach out to the provider when the sampled prices have actually gone
  // stale; otherwise every render would cost a request per held symbol.
  const freshness = await loadPriceFreshness();
  if (freshness.stale) {
    const symbols = await loadHeldSymbols(classroom.id);
    if (symbols.length > 0) await getQuotes(symbols);
  }

  const [students, overview, trades, defaultCapital] = await Promise.all([
    loadStudents(classroom.id),
    loadClassOverview(classroom.id),
    loadTradeHistory({ classroomId: classroom.id, limit: 8 }),
    loadDefaultStartingCapital(classroom.id),
  ]);

  // loadStudents() returns members in join order. Rank them the way the
  // leaderboard does before anything reads a "best" or "worst" off position 0 —
  // otherwise the table is not actually in value order, and the tiles below
  // describe the wrong student.
  const ranked = [...students].sort(
    (a, b) => b.totalValue - a.totalValue || a.displayName.localeCompare(b.displayName),
  );

  // Best and worst performer come from get_class_overview(), but every figure
  // that function uses comes from the same leaderboard already loaded above. So
  // fall back to it: one failing RPC should degrade a single tile, not blank it.
  const leader = ranked[0] ?? null;
  const lagging = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const leaderName = overview?.leader ?? leader?.displayName ?? "—";
  const laggingName = overview?.lagging ?? lagging?.displayName ?? "—";

  const classValue = students.reduce((sum, student) => sum + student.totalValue, 0);
  const classCapital = students.reduce(
    (sum, student) => sum + (student.totalValue - student.totalPnl),
    0,
  );
  const averageReturn =
    students.length > 0
      ? students.reduce((sum, student) => sum + student.totalPnlPercent, 0) /
        students.length
      : 0;
  const classPnl = classValue - classCapital;
  const tradingNow = students.filter((student) => student.tradeCount > 0).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-title font-medium text-ink">{classroom.name}</h1>
            {classroom.section ? (
              <Badge tone="neutral">{classroom.section}</Badge>
            ) : null}
            <Badge tone={settings?.tradingEnabled ? "pos" : "warn"}>
              {settings?.tradingEnabled ? "Trading open" : "Trading paused"}
            </Badge>
          </div>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            {students.length} student{students.length === 1 ? "" : "s"}
            {/* Only claim a trade count when the overview actually returned one —
                "0 trades in the last 24 hours" would be a lie, not a fallback. */}
            {overview ? (
              <>
                {" · "}
                {overview.trades24h} trade{overview.trades24h === 1 ? "" : "s"} in the
                last 24 hours
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshMarketButton classroomId={classroom.id} />
          <Button asChild size="sm" variant="secondary">
            <Link href={`/api/teacher/export?classroomId=${classroom.id}`} prefetch={false}>
              <Download />
              Export CSV
            </Link>
          </Button>
          <Button asChild size="sm" variant="primary">
            <Link href="/teacher/students">Manage students</Link>
          </Button>
        </div>
      </header>

      {!settings?.tradingEnabled ? (
        <Notice tone="warn">
          Trading is paused for this class.{" "}
          {settings?.pausedReason?.trim() || "Students cannot place orders."}
        </Notice>
      ) : null}

      <Panel className="px-5 py-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3 xl:grid-cols-6">
          <MetricTile
            label="Class portfolio value"
            value={formatMoney(classValue)}
            size="lg"
            hint={`${formatPercent(averageReturn, { signed: true })} average return`}
          />
          <MetricTile
            label="Class P/L"
            tone={classPnl}
            value={formatSignedMoney(classPnl)}
            hint={`Against ${formatMoney(classCapital)} of capital`}
          />
          <MetricTile
            label="Students"
            value={students.length}
            hint={`${tradingNow} have placed a trade`}
          />
          <MetricTile
            label="Cash on hand"
            value={formatMoney(students.reduce((sum, s) => sum + s.cashBalance, 0))}
            hint="Uninvested across the class"
          />
          <MetricTile
            label="Best performer"
            value={<span className="text-[17px]">{leaderName}</span>}
            tone={leader?.totalPnl}
            hint={leader ? formatSignedMoney(leader.totalPnl) : "No students yet"}
          />
          <MetricTile
            label="Needs support"
            value={<span className="text-[17px]">{laggingName}</span>}
            tone={lagging?.totalPnl}
            hint={
              lagging
                ? formatSignedMoney(lagging.totalPnl)
                : ranked.length === 0
                  ? "No students yet"
                  : "Needs at least two students"
            }
          />
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Students"
            description="Ranked by portfolio value. Every figure comes from the database."
            action={
              <Button asChild size="sm" variant="ghost">
                <Link href="/teacher/students">
                  <Users />
                  View all
                </Link>
              </Button>
            }
          />
          <StudentTable
            students={ranked.slice(0, 8)}
            classroomId={classroom.id}
            defaultStartingCapital={defaultCapital}
          />
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="Recent activity"
              action={
                <Button asChild size="sm" variant="ghost">
                  <Link href="/teacher/activity">
                    <Activity />
                    All trades
                  </Link>
                </Button>
              }
            />
            <TransactionTable
              trades={trades}
              showStudent
              emptyTitle="No trades yet."
              emptyDescription="Buy and sell orders from your students will appear here as they are placed."
            />
          </Panel>

          <JoinCodeCard code={classroom.joinCode} />
        </div>
      </div>
    </div>
  );
}
