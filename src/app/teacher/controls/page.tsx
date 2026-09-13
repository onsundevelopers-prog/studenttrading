import { Download } from "lucide-react";
import Link from "next/link";

import { JoinCodeCard } from "@/components/teacher/join-code-card";
import {
  AssetAllowlistForm,
  ClassSettingsForm,
  RefreshMarketButton,
  ResetClassroomDialog,
} from "@/components/teacher/teacher-controls";
import { Button } from "@/components/ui/button";
import { Notice, Panel, PanelHeader } from "@/components/ui/primitives";
import { getTeacherWorkspace } from "@/lib/auth/context";
import {
  loadClassroomAssetIds,
  loadDefaultStartingCapital,
  loadStudents,
  loadTradeableAssets,
} from "@/lib/data/queries";
import { hasFinnhubKey } from "@/lib/env";

export default async function TeacherControlsPage() {
  const { classroom, settings } = await getTeacherWorkspace();
  if (!classroom || !settings) return null;

  const [assets, selectedIds, defaultCapital, students] = await Promise.all([
    loadTradeableAssets(300),
    loadClassroomAssetIds(classroom.id),
    loadDefaultStartingCapital(classroom.id),
    loadStudents(classroom.id),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-title font-medium text-ink">Simulation controls</h1>
        <p className="mt-1.5 text-[12px] text-ink-tertiary">
          Everything on this page is enforced server-side. Hiding a button would
          not be enough, so each rule is re-checked for every order.
        </p>
      </header>

      {!hasFinnhubKey() ? (
        <Notice tone="neg">
          FINNHUB_API_KEY is not set, so no live prices can be fetched. Trading is
          blocked and portfolios will keep using their last known prices.
        </Notice>
      ) : null}

      <ClassSettingsForm
        classroomId={classroom.id}
        settings={settings}
        defaultStartingCapital={defaultCapital}
      />

      <AssetAllowlistForm
        classroomId={classroom.id}
        assets={assets}
        selectedIds={selectedIds}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Market data"
            description="Prices are sampled from the provider and cached server-side. The snapshot record keeps the performance chart honest."
          />
          <div className="space-y-4 p-4">
            <RefreshMarketButton classroomId={classroom.id} />
            <p className="text-[12px] leading-relaxed text-ink-tertiary">
              Refreshing prices also records one portfolio snapshot per student,
              which is what the performance charts are drawn from. A scheduled
              sampler is available at{" "}
              <code className="rounded border border-hairline bg-surface-2 px-1 py-[1px] font-mono text-[11px] text-ink-muted">
                /api/cron/sample
              </code>{" "}
              for deployment (see README).
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Export and reset"
            description="Export before you reset: resetting permanently deletes trades, positions and snapshots for this classroom."
          />
          <div className="space-y-4 p-4">
            <Button asChild size="md" variant="secondary">
              <Link
                href={`/api/teacher/export?classroomId=${classroom.id}`}
                prefetch={false}
              >
                <Download />
                Export results as CSV
              </Link>
            </Button>
            <div className="border-t border-hairline pt-4">
              <ResetClassroomDialog
                classroomId={classroom.id}
                defaultStartingCapital={defaultCapital}
                studentCount={students.length}
              />
            </div>
          </div>
        </Panel>
      </div>

      <JoinCodeCard code={classroom.joinCode} />
    </div>
  );
}
