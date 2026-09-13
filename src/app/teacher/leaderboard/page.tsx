import { Download } from "lucide-react";
import Link from "next/link";

import { LeaderboardTable } from "@/components/data/leaderboard-table";
import { RefreshMarketButton } from "@/components/teacher/teacher-controls";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { getTeacherWorkspace } from "@/lib/auth/context";
import {
  loadHeldSymbols,
  loadLeaderboard,
  loadPriceFreshness,
} from "@/lib/data/queries";
import { getQuotes } from "@/lib/market/service";

export default async function TeacherLeaderboardPage() {
  const { classroom } = await getTeacherWorkspace();
  if (!classroom) return null;

  const freshness = await loadPriceFreshness();
  if (freshness.stale) {
    const symbols = await loadHeldSymbols(classroom.id);
    if (symbols.length > 0) await getQuotes(symbols);
  }

  const rows = await loadLeaderboard(classroom.id);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium text-ink">Leaderboard</h1>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            Ranked by total portfolio value: available cash plus investments,
            valued at the latest price.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshMarketButton classroomId={classroom.id} />
          <Button asChild size="sm" variant="secondary">
            <Link
              href={`/api/teacher/export?classroomId=${classroom.id}`}
              prefetch={false}
            >
              <Download />
              Export CSV
            </Link>
          </Button>
        </div>
      </header>

      <Panel>
        <PanelHeader
          title="Standings"
          description="Updated each time prices are refreshed."
        />
        <LeaderboardTable rows={rows} />
      </Panel>
    </div>
  );
}
