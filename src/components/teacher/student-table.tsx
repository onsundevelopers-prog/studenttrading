import Link from "next/link";
import { Users } from "lucide-react";

import { PercentCell } from "@/components/data/atoms";
import { StudentActions } from "@/components/teacher/student-actions";
import {
  DataTable,
  EmptyState,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { formatMoney, formatRelative, formatSignedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StudentSummary } from "@/lib/data/queries";

export function StudentTable({
  students,
  classroomId,
  defaultStartingCapital,
}: {
  students: StudentSummary[];
  classroomId: string;
  defaultStartingCapital: number;
}) {
  if (students.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="No students yet."
        description="Add students to this classroom and give each one the username and password they will use to sign in."
      />
    );
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th className="pl-4">Student</Th>
          <Th align="right">Portfolio Value</Th>
          <Th align="right">Available Cash</Th>
          <Th align="right">Investments</Th>
          <Th align="right">Profit and Loss</Th>
          <Th align="right">Total Return</Th>
          <Th align="right">Trades Placed</Th>
          <Th align="right">Last Activity</Th>
          <Th align="right" className="pr-4">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {students.map((student) => (
          <Tr key={student.studentId}>
            <Td className="pl-4">
              <Link
                href={`/teacher/students/${student.studentId}`}
                className="block outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2">
                  <span className="max-w-[200px] truncate text-[13px] font-medium text-ink">
                    {student.displayName}
                  </span>
                  {student.rank === 1 && students.length > 1 ? (
                    <span className="rounded-full border border-brand/40 bg-brand/15 px-1.5 py-[1px] text-[10px] text-[#a8b1ff]">
                      #1
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-ink-tertiary">
                  {student.handle ?? "no handle"}
                  {student.externalId ? ` · ${student.externalId}` : ""}
                </span>
              </Link>
            </Td>
            <Td align="right" className="font-medium text-ink">
              {formatMoney(student.totalValue)}
            </Td>
            <Td align="right" className="text-ink-subtle">
              {formatMoney(student.cashBalance)}
            </Td>
            <Td align="right" className="text-ink-subtle">
              {formatMoney(student.holdingsValue)}
            </Td>
            <Td align="right">
              <span
                className={cn(
                  "num",
                  student.totalPnl > 0
                    ? "text-pos"
                    : student.totalPnl < 0
                      ? "text-neg"
                      : "text-ink-subtle",
                )}
              >
                {formatSignedMoney(student.totalPnl)}
              </span>
            </Td>
            <Td align="right">
              <PercentCell value={student.totalPnlPercent} />
            </Td>
            <Td align="right" className="text-ink-subtle">
              {student.tradeCount}
            </Td>
            <Td align="right" className="whitespace-nowrap text-ink-tertiary">
              {student.lastTradeAt ? formatRelative(student.lastTradeAt) : "never"}
            </Td>
            <Td align="right" className="pr-3">
              <div className="flex justify-end">
                <StudentActions
                  classroomId={classroomId}
                  studentId={student.studentId}
                  studentName={student.displayName}
                  defaultStartingCapital={defaultStartingCapital}
                />
              </div>
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}
