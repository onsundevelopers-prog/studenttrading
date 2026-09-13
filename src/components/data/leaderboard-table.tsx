import { Trophy, Users } from "lucide-react";

import { PercentCell } from "@/components/data/atoms";
import {
  DataTable,
  EmptyState,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { formatMoney, formatRelative, formatSignedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeaderboardRow } from "@/lib/types";

function RankCell({ rank }: { rank: number }) {
  const top = rank === 1;
  return (
    <span
      className={cn(
        "num inline-flex h-6 w-6 items-center justify-center rounded-md border text-[12px] font-medium",
        top
          ? "border-brand/45 bg-brand/15 text-[#a8b1ff]"
          : "border-hairline bg-surface-2 text-ink-subtle",
      )}
    >
      {rank}
    </span>
  );
}

export function LeaderboardTable({
  rows,
  highlightStudentId,
  emptyTitle = "No students to rank yet.",
  emptyDescription = "Standings appear once students have joined the class and have a portfolio value.",
}: {
  rows: LeaderboardRow[];
  highlightStudentId?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th className="w-12 pl-4">Rank</Th>
          <Th>Student</Th>
          <Th align="right">Portfolio Value</Th>
          <Th align="right">Available Cash</Th>
          <Th align="right">Investments</Th>
          <Th align="right">Total Return</Th>
          <Th align="right">Profit and Loss</Th>
          <Th align="right">Trades Placed</Th>
          <Th align="right" className="pr-4">
            Last Activity
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isYou = row.studentId === highlightStudentId;
          return (
            <Tr
              key={row.studentId}
              className={cn(isYou && "bg-brand/6 hover:bg-brand/10")}
            >
              <Td className="pl-4">
                <RankCell rank={row.rank} />
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <span className="max-w-[200px] truncate text-[13px] font-medium text-ink">
                    {row.displayName}
                  </span>
                  {isYou ? (
                    <span className="rounded-full border border-brand/40 bg-brand/15 px-1.5 py-[1px] text-[10px] text-[#a8b1ff]">
                      You
                    </span>
                  ) : null}
                  {row.rank === 1 ? (
                    <Trophy className="size-3.5 text-[#a8b1ff]" aria-label="First place" />
                  ) : null}
                </div>
                {row.loginHandle ? (
                  <span className="mt-0.5 block font-mono text-[11px] text-ink-tertiary">
                    {row.loginHandle}
                  </span>
                ) : null}
              </Td>
              <Td align="right" className="font-medium text-ink">
                {formatMoney(row.totalValue)}
              </Td>
              <Td align="right" className="text-ink-subtle">
                {formatMoney(row.cashBalance)}
              </Td>
              <Td align="right" className="text-ink-subtle">
                {formatMoney(row.holdingsValue)}
              </Td>
              <Td align="right">
                <PercentCell value={row.totalPnlPercent} />
              </Td>
              <Td align="right">
                <span
                  className={cn(
                    "num",
                    row.totalPnl > 0
                      ? "text-pos"
                      : row.totalPnl < 0
                        ? "text-neg"
                        : "text-ink-subtle",
                  )}
                >
                  {formatSignedMoney(row.totalPnl)}
                </span>
              </Td>
              <Td align="right" className="text-ink-subtle">
                {row.tradeCount}
              </Td>
              <Td align="right" className="whitespace-nowrap pr-4 text-ink-tertiary">
                {row.lastTradeAt ? formatRelative(row.lastTradeAt) : "never"}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

/** Compact top-N list for the student dashboard sidebar. */
export function LeaderboardMini({
  rows,
  highlightStudentId,
  limit = 5,
}: {
  rows: LeaderboardRow[];
  highlightStudentId?: string;
  limit?: number;
}) {
  const visible = rows.slice(0, limit);
  const you = rows.find((row) => row.studentId === highlightStudentId);
  const youOutsideTop = you && !visible.some((row) => row.studentId === you.studentId);

  return (
    <ul className="divide-y divide-hairline">
      {[...visible, ...(youOutsideTop && you ? [you] : [])].map((row) => {
        const isYou = row.studentId === highlightStudentId;
        return (
          <li
            key={row.studentId}
            className={cn(
              "flex items-center gap-3 px-4 py-2",
              isYou && "bg-brand/6",
            )}
          >
            <span className="num w-5 shrink-0 text-[12px] text-ink-tertiary">
              {row.rank}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
              {row.displayName}
            </span>
            <span className="shrink-0 text-right">
              <span className="block num text-[13px] text-ink">
                {formatMoney(row.totalValue)}
              </span>
              <span className="block num text-[11px]">
                <PercentCell value={row.totalPnlPercent} />
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
