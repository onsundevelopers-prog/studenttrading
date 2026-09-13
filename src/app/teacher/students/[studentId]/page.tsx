import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PercentCell } from "@/components/data/atoms";
import { HoldingsTable } from "@/components/data/holdings-table";
import { PerformancePanel } from "@/components/data/performance-panel";
import { PortfolioSummary } from "@/components/data/portfolio-summary";
import { TransactionTable } from "@/components/data/transaction-table";
import { StudentActions } from "@/components/teacher/student-actions";
import { Button } from "@/components/ui/button";
import { Badge, Notice, Panel, PanelHeader } from "@/components/ui/primitives";
import { getTeacherWorkspace } from "@/lib/auth/context";
import {
  loadDefaultStartingCapital,
  loadPortfolio,
  loadSnapshots,
  loadStudents,
  loadTradeHistory,
} from "@/lib/data/queries";
import { formatMoney, formatRelative } from "@/lib/format";

export default async function TeacherStudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const { classroom } = await getTeacherWorkspace();
  if (!classroom) return null;

  // `loadPortfolio` returns null unless the student is an active member of this
  // classroom, so this doubles as the authorisation check.
  const [portfolio, students, snapshots, trades, defaultCapital] = await Promise.all([
    loadPortfolio(classroom.id, studentId),
    loadStudents(classroom.id),
    loadSnapshots(classroom.id, studentId, 400),
    loadTradeHistory({ classroomId: classroom.id, studentId, limit: 50 }),
    loadDefaultStartingCapital(classroom.id),
  ]);

  if (!portfolio) notFound();

  const student = students.find((item) => item.studentId === studentId);

  return (
    <div className="space-y-5">
      <div>
        <Button asChild size="sm" variant="ghost" className="-ml-2">
          <Link href="/teacher/students">
            <ArrowLeft />
            All students
          </Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title font-medium text-ink">
              {student?.displayName ?? "Student"}
            </h1>
            {student?.rank ? <Badge tone="neutral">Rank {student.rank}</Badge> : null}
            {student?.handle ? (
              <span className="font-mono text-[12px] text-ink-tertiary">
                {student.handle}
              </span>
            ) : null}
            {student?.externalId ? (
              <span className="text-[12px] text-ink-tertiary">
                ID {student.externalId}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            {portfolio.tradeCount} trade{portfolio.tradeCount === 1 ? "" : "s"} ·
            last activity {formatRelative(portfolio.lastTradeAt)} · starting
            capital {formatMoney(portfolio.initialCapital)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PercentCell value={portfolio.totalPnlPercent} className="text-[14px]" />
          <StudentActions
            classroomId={classroom.id}
            studentId={studentId}
            studentName={student?.displayName ?? "this student"}
            defaultStartingCapital={defaultCapital}
          />
        </div>
      </header>

      <Panel className="px-5 py-4">
        <PortfolioSummary portfolio={portfolio} />
      </Panel>

      <PerformancePanel
        snapshots={snapshots}
        initialCapital={portfolio.initialCapital}
        title="Portfolio performance"
      />

      <Panel>
        <PanelHeader
          title="Holdings"
          description="Marked at the latest sampled price for each asset."
        />
        <HoldingsTable holdings={portfolio.holdings} />
      </Panel>

      <Panel>
        <PanelHeader title="Trade history" />
        <TransactionTable
          trades={trades}
          emptyTitle="This student has not traded yet."
          emptyDescription="Their orders will appear here as soon as they place one."
        />
      </Panel>

      {portfolio.pricesIncomplete ? (
        <Notice tone="warn">
          At least one position has no sampled price yet, so its cost basis is
          being used. Use “Refresh prices” on the overview to fill the gap.
        </Notice>
      ) : null}
    </div>
  );
}
