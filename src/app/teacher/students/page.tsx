import { Download } from "lucide-react";
import Link from "next/link";

import { AddStudentsForm } from "@/components/teacher/add-students-form";
import { FundRequestsPanel } from "@/components/teacher/fund-requests-panel";
import { JoinCodeCard } from "@/components/teacher/join-code-card";
import { StudentTable } from "@/components/teacher/student-table";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { getTeacherWorkspace } from "@/lib/auth/context";
import {
  loadDefaultStartingCapital,
  loadFundRequests,
  loadHeldSymbols,
  loadPriceFreshness,
  loadStudents,
} from "@/lib/data/queries";
import { getQuotes } from "@/lib/market/service";
import { formatMoney, formatPercent, formatSignedMoney } from "@/lib/format";

export default async function TeacherStudentsPage() {
  const { classroom } = await getTeacherWorkspace();
  if (!classroom) return null;

  const freshness = await loadPriceFreshness();
  if (freshness.stale) {
    const symbols = await loadHeldSymbols(classroom.id);
    if (symbols.length > 0) await getQuotes(symbols);
  }

  const [students, defaultCapital, pendingRequests] = await Promise.all([
    loadStudents(classroom.id),
    loadDefaultStartingCapital(classroom.id),
    loadFundRequests({ classroomId: classroom.id, status: "pending", limit: 25 }),
  ]);

  const classValue = students.reduce((sum, student) => sum + student.totalValue, 0);
  const classPnl = students.reduce((sum, student) => sum + student.totalPnl, 0);
  const averageReturn =
    students.length > 0
      ? students.reduce((sum, student) => sum + student.totalPnlPercent, 0) /
        students.length
      : 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium text-ink">Students</h1>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            {students.length} enrolled · {formatMoney(classValue)} class value ·{" "}
            <span
              className={
                classPnl > 0 ? "text-pos" : classPnl < 0 ? "text-neg" : undefined
              }
            >
              {formatSignedMoney(classPnl)}
            </span>{" "}
            ({formatPercent(averageReturn, { signed: true })} average)
          </p>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href={`/api/teacher/export?classroomId=${classroom.id}`} prefetch={false}>
            <Download />
            Export CSV
          </Link>
        </Button>
      </header>

      {pendingRequests.length > 0 ? (
        <FundRequestsPanel requests={pendingRequests} />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <AddStudentsForm
            classroomId={classroom.id}
            defaultStartingCapital={defaultCapital}
          />
        </div>
        <JoinCodeCard code={classroom.joinCode} />
      </div>

      <Panel>
        <PanelHeader
          title="Class roster"
          description="Per-student portfolio value, cash, P/L and activity. Use the row menu to adjust balances, reset a portfolio or issue a new password."
        />
        <StudentTable
          students={students}
          classroomId={classroom.id}
          defaultStartingCapital={defaultCapital}
        />
      </Panel>
    </div>
  );
}
