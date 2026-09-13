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
 * The series is the `portfolio_snapshots` table and nothing else: a value is
 * recorded on every fill and by the scheduled sampler. A brand-new account
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
            ? `${snapshots.length} recorded value${snapshots.length === 1 ? "" : "s"} · from ${formatMoney(first.totalValue)} to ${formatMoney(last.totalValue)}`
            : undefined
        }
        action={refreshAction}
      />
      <PanelBody className="pt-4">
        {snapshots.length === 0 ? (
          <EmptyState
            icon={<ChartLine className="size-5" />}
            title="Your portfolio history will appear here."
            description="Your portfolio value is recorded every time you trade and each time prices are refreshed. The chart is drawn from those records — nothing here is guessed."
            action={
              refreshAction ? (
                <div className="flex items-center gap-2 text-[12px] text-ink-tertiary">
                  <RefreshCw className="size-3.5" />
                  Use refresh above to record the first value.
                </div>
              ) : undefined
            }
          />
        ) : snapshots.length === 1 ? (
          <div className="space-y-3">
            <EmptyState
              icon={<ChartLine className="size-5" />}
              title="Only one value recorded so far."
              description={`Your portfolio was worth ${formatMoney(last.totalValue)} at ${new Date(last.capturedAt).toLocaleString()}. A trend needs at least two values, so no line is drawn yet.`}
            />
          </div>
        ) : (
          <PortfolioChart snapshots={snapshots} initialCapital={initialCapital} />
        )}

        {snapshots.length > 0 && snapshots.length < 3 ? (
          <Notice className="mt-4">
            Only {snapshots.length} value{snapshots.length === 1 ? "" : "s"} have been
            recorded so far, so this line is very short. Trading, or refreshing
            prices, adds more points.
          </Notice>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

export function RefreshMarketButton({
  action,
  label = "Record Current Value",
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
