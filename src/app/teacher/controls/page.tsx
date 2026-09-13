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
          Every rule on this page is enforced on the server for each order, so a
          student cannot bypass it from the browser.
        </p>
      </header>

      {!hasFinnhubKey() ? (
        <Notice tone="neg">
          No market data provider key is configured, so live prices cannot be
          fetched. Trading is blocked and portfolios keep their last known prices
          until the provider is set up (see the README).
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
            description="Prices are fetched from our market data source and kept on the server for a short time. Each refresh also records every student's portfolio value."
          />
          <div className="space-y-4 p-4">
            <RefreshMarketButton classroomId={classroom.id} />
            <p className="text-[12px] leading-relaxed text-ink-tertiary">
              The recorded portfolio values are what the performance charts are
              drawn from, so refreshing prices also updates those charts. A
              scheduled job can do this automatically at{" "}
              <code className="rounded border border-hairline bg-surface-2 px-1 py-[1px] font-mono text-[11px] text-ink-muted">
                /api/cron/sample
              </code>{" "}
              (see README).
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Export and reset"
            description="Export before you reset: resetting permanently deletes trades, investments and recorded portfolio values for this classroom."
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
