import Link from "next/link";

import { TransactionTable } from "@/components/data/transaction-table";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { getTeacherWorkspace } from "@/lib/auth/context";
import { loadStudents, loadTradeHistory } from "@/lib/data/queries";

export default async function TeacherActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const { classroom } = await getTeacherWorkspace();
  if (!classroom) return null;

  const { student: studentId } = await searchParams;

  const [students, trades] = await Promise.all([
    loadStudents(classroom.id),
    loadTradeHistory({
      classroomId: classroom.id,
      studentId: studentId ?? null,
      limit: 250,
    }),
  ]);

  const selected = students.find((item) => item.studentId === studentId);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium text-ink">Trade activity</h1>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            The most recent {trades.length} filled order
            {trades.length === 1 ? "" : "s"}
            {selected ? ` for ${selected.displayName}` : " across the class"}. Every
            order the engine accepted is recorded here permanently.
          </p>
        </div>
        {selected ? (
          <Button asChild size="sm" variant="secondary">
            <Link href="/teacher/activity">Clear filter</Link>
          </Button>
        ) : null}
      </header>

      <Panel>
        <PanelHeader
          title={selected ? `${selected.displayName}'s trades` : "All trades"}
          action={
            students.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-tertiary">Filter:</span>
                {students.slice(0, 8).map((student) => (
                  <Link
                    key={student.studentId}
                    href={`/teacher/activity?student=${student.studentId}`}
                    className={
                      student.studentId === studentId
                        ? "rounded-full border border-brand/45 bg-brand/15 px-2 py-[2px] text-[11px] text-[#a8b1ff]"
                        : "rounded-full border border-hairline bg-surface-2 px-2 py-[2px] text-[11px] text-ink-subtle transition-colors hover:text-ink"
                    }
                  >
                    {student.displayName}
                  </Link>
                ))}
              </div>
            ) : null
          }
        />
        <TransactionTable
          trades={trades}
          showStudent
          emptyTitle="No trades recorded yet."
          emptyDescription="Once students start placing orders they will appear here, with the price each trade was completed at."
        />
      </Panel>
    </div>
  );
}
