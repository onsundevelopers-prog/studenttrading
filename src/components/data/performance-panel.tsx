import { ChartLine, RefreshCw } from "lucide-react";

import { PortfolioChart } from "@/components/data/charts";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import type { PortfolioSnapshot } from "@/lib/types";

/**
 * Portfolio value over time.
 *
 * The series is the `portfolio_snapshots` table and nothing else: a snapshot is
 * written on every fill and by the scheduled sampler. A brand-new account
 * therefore shows one point, and the panel says exactly that rather than
 * drawing a plausible-looking curve.
 */
export function PerformancePanel({
  snapshots,
  initialCapital,
  title = "Portfolio performance",
  refreshAction,
}: {
  snapshots: PortfolioSnapshot[];
  initialCapital: number;
  title?: string;
  refreshAction?: React.ReactNode;
}) {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  return (
    <Panel>
      <PanelHeader
        title={title}
        description={
          snapshots.length > 0
            ? `${snapshots.length} recorded snapshot${snapshots.length === 1 ? "" : "s"} · from ${formatMoney(first.totalValue)} to ${formatMoney(last.totalValue)}`
            : undefined
        }
        action={refreshAction}
      />
      <PanelBody className="pt-4">
        {snapshots.length === 0 ? (
          <EmptyState
            icon={<ChartLine className="size-5" />}
            title="No portfolio history yet."
            description="A snapshot is recorded every time you trade, and again whenever the simulator samples the market. The chart draws itself from those points — nothing here is estimated."
            action={
              refreshAction ? (
                <div className="flex items-center gap-2 text-[12px] text-ink-tertiary">
                  <RefreshCw className="size-3.5" />
                  Use refresh above to record the first snapshot.
                </div>
              ) : undefined
            }
          />
        ) : snapshots.length === 1 ? (
          <div className="space-y-3">
            <EmptyState
              icon={<ChartLine className="size-5" />}
              title="One snapshot recorded."
              description={`Portfolio value ${formatMoney(last.totalValue)} at ${new Date(last.capturedAt).toLocaleString()}. A trend needs at least two points, so no line is drawn yet.`}
            />
          </div>
        ) : (
          <PortfolioChart snapshots={snapshots} initialCapital={initialCapital} />
        )}

        {snapshots.length > 0 && snapshots.length < 3 ? (
          <Notice className="mt-4">
            Only {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} have
            been recorded so far, so this line is very short. Trading, or
            refreshing market data, adds more points.
          </Notice>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

export function RefreshMarketButton({
  action,
  label = "Record snapshot",
}: {
  action: (formData: FormData) => Promise<void>;
  label?: string;
}) {
  return (
    <form action={action}>
      <Button type="submit" size="sm" variant="secondary">
        <RefreshCw />
        {label}
      </Button>
    </form>
  );
}
