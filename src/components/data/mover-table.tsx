import Link from "next/link";

import { NotAvailable } from "@/components/data/atoms";
import { DataTable, EmptyState, Td, Th, Tr } from "@/components/ui/primitives";
import {
  formatPrice,
  formatSignedMoney,
  formatSignedPercent,
  formatVolume,
} from "@/lib/format";
import type { MoverQuote } from "@/lib/market/service";
import { cn } from "@/lib/utils";

/**
 * A movers board: gainers, losers and most-active names.
 *
 * Rows are real provider snapshots from `getMarketMovers`. A symbol the provider
 * could not price is simply absent — the board is never padded with a
 * placeholder row, and an empty board renders its empty state instead.
 */

export type MoverMetric = "dayRange" | "volume" | "turnover";

export function MoverTable({
  title,
  description,
  rows,
  metric,
  assetHrefPrefix,
  emptyDescription,
}: {
  title: string;
  description?: string;
  rows: MoverQuote[];
  metric: MoverMetric;
  assetHrefPrefix: string;
  emptyDescription: string;
}) {
  const metricHeading =
    metric === "volume"
      ? "Trading Volume"
      : metric === "turnover"
        ? "Value Traded Today"
        : "Price Range Today";

  return (
    <section className="rounded-lg border border-hairline bg-surface-1">
      <header className="border-b border-hairline px-4 py-3">
        <h2 className="text-[13px] font-medium leading-tight text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-[12px] leading-snug text-ink-tertiary">{description}</p>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState title="Nothing to show here yet." description={emptyDescription} />
        </div>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <Th className="pl-4">Company</Th>
              <Th align="right">Current Price</Th>
              <Th align="right">Change Today</Th>
              <Th align="right" className="pr-4">
                {metricHeading}
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.symbol}>
                <Td className="pl-4">
                  <Link
                    href={`${assetHrefPrefix}/${encodeURIComponent(row.symbol)}`}
                    className="flex min-w-0 items-center gap-2.5 rounded-md outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="inline-flex h-7 min-w-[54px] items-center justify-center rounded-md border border-hairline bg-surface-2 px-1.5 font-mono text-[11px] font-medium tracking-tight text-ink-muted">
                      {row.displaySymbol}
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-[190px] truncate text-[13px] text-ink">
                        {row.name}
                      </span>
                      <span className="block font-mono text-[11px] text-ink-tertiary">
                        {row.symbol}
                      </span>
                    </span>
                  </Link>
                </Td>
                <Td align="right" className="font-medium text-ink">
                  {formatPrice(row.price, "stock")}
                </Td>
                <Td align="right">
                  <span className="flex flex-col items-end">
                    <span
                      className={cn(
                        "num",
                        (row.changePercent ?? 0) > 0
                          ? "text-pos"
                          : (row.changePercent ?? 0) < 0
                            ? "text-neg"
                            : "text-ink-subtle",
                      )}
                    >
                      {formatSignedPercent(row.changePercent)}
                    </span>
                    <span className="num text-[11px] text-ink-tertiary">
                      {formatSignedMoney(row.change)}
                    </span>
                  </span>
                </Td>
                <Td align="right" className="pr-4 text-ink-subtle">
                  <MetricCell row={row} metric={metric} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

function MetricCell({ row, metric }: { row: MoverQuote; metric: MoverMetric }) {
  if (metric === "volume") {
    return <span className="num">{formatVolume(row.volume)}</span>;
  }

  if (metric === "turnover") {
    if (row.dollarVolume === null || Number.isNaN(row.dollarVolume)) {
      return (
        <NotAvailable reason="No trading volume was reported for this company today." />
      );
    }
    return <span className="num">{formatTurnover(row.dollarVolume)}</span>;
  }

  // Previous close → last is the session's move, not a 52-week range. It is
  // labelled as such rather than dressed up as something it is not.
  if (row.change === null) {
    return (
      <NotAvailable reason="No previous closing price was reported, so today's price range cannot be worked out." />
    );
  }
  const previousClose = row.price - row.change;
  return (
    <span className="num">
      {formatPrice(Math.min(previousClose, row.price))} –{" "}
      {formatPrice(Math.max(previousClose, row.price))}
    </span>
  );
}

function formatTurnover(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}
