import { MetricTile } from "@/components/data/atoms";
import { LeaderboardTable } from "@/components/data/leaderboard-table";
import { RefreshMarketButton } from "@/components/teacher/teacher-controls";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { getStudentWorkspace } from "@/lib/auth/context";
import { loadLeaderboard } from "@/lib/data/queries";
import { formatMoney, formatSignedMoney } from "@/lib/format";

export default async function StudentLeaderboardPage() {
  const { classroom, session } = await getStudentWorkspace();
  if (!classroom) return null;

  const rows = await loadLeaderboard(classroom.id);
  const me = rows.find((row) => row.studentId === session.userId);
  const leader = rows[0];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium text-ink">Class leaderboard</h1>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            Ranked by total portfolio value: cash plus positions at the latest
            sampled price.
          </p>
        </div>
        <RefreshMarketButton classroomId={classroom.id} />
      </header>

      <Panel className="px-5 py-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <MetricTile
            label="Your rank"
            value={me ? `#${me.rank}` : "—"}
            hint={me ? `of ${rows.length} students` : "Not ranked yet"}
            size="lg"
          />
          <MetricTile
            label="Your portfolio"
            value={formatMoney(me?.totalValue ?? 0)}
            tone={me?.totalPnlPercent}
            aside={
              <span className="num text-[13px] text-ink-subtle">
                {me ? formatSignedMoney(me.totalPnl) : "—"}
              </span>
            }
          />
          <MetricTile
            label="Class leader"
            value={<span className="text-[17px]">{leader?.displayName ?? "—"}</span>}
            hint={leader ? formatMoney(leader.totalValue) : undefined}
          />
          <MetricTile
            label="Class average return"
            value={
              rows.length > 0
                ? `${(
                    rows.reduce((sum, row) => sum + row.totalPnlPercent, 0) /
                    rows.length
                  ).toFixed(2)}%`
                : "—"
            }
            hint={`${rows.length} student${rows.length === 1 ? "" : "s"} ranked`}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Standings"
          description="Every student sees the same numbers — this table is computed from the database, not from your browser."
        />
        <LeaderboardTable rows={rows} highlightStudentId={session.userId} />
      </Panel>
    </div>
  );
}
