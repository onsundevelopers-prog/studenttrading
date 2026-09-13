import { EmptyState } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import type { Holding } from "@/lib/types";

/**
 * Portfolio allocation.
 *
 * Weight is computed from the same market values the holdings table shows, so
 * the two can never disagree. Cash is included as its own slice when there is
 * any, because a portfolio that is 90% cash is a different portfolio from one
 * that is 90% shares — hiding cash would misstate the allocation.
 *
 * Colours are a fixed, muted sequence keyed by position, not by sentiment: an
 * allocation is not "up" or "down".
 */

const SLICE_COLORS = [
  "#5e6ad2",
  "#3f8f7a",
  "#8a6fbf",
  "#b06a4a",
  "#4a7fb0",
  "#7a8a3f",
  "#a05a7a",
  "#5f8a9e",
];

export function AllocationBar({
  holdings,
  cashBalance,
}: {
  holdings: Holding[];
  cashBalance?: number;
}) {
  const holdingsValue = holdings.reduce((sum, item) => sum + item.marketValue, 0);
  const cash = cashBalance ?? 0;
  const total = holdingsValue + cash;

  if (holdings.length === 0) {
    return (
      <EmptyState
        title="Nothing to show here yet."
        description="Buy your first investment to see how your money is divided up."
      />
    );
  }

  if (total <= 0) {
    return (
      <EmptyState
        title="Nothing to show here yet."
        description="Your investments are currently valued at zero, so there is nothing to divide up."
      />
    );
  }

  const slices = holdings
    .map((holding, index) => ({
      key: holding.assetId,
      label: holding.displaySymbol,
      value: holding.marketValue,
      color: SLICE_COLORS[index % SLICE_COLORS.length],
    }))
    .sort((a, b) => b.value - a.value);

  if (cash > 0) {
    slices.push({
      key: "cash",
      label: "Cash",
      value: cash,
      color: "#3a3d44",
    });
  }

  return (
    <div className="space-y-3">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={slices
          .map((slice) => `${slice.label} ${((slice.value / total) * 100).toFixed(1)}%`)
          .join(", ")}
      >
        {slices.map((slice) => (
          <span
            key={slice.key}
            style={{
              width: `${(slice.value / total) * 100}%`,
              backgroundColor: slice.color,
            }}
          />
        ))}
      </div>

      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: slice.color }}
              />
              <span className="truncate font-mono text-[11px] text-ink-muted">
                {slice.label}
              </span>
            </span>
            <span className="shrink-0 num text-ink-subtle">
              {((slice.value / total) * 100).toFixed(1)}%
              <span className="ml-2 text-ink-tertiary">{formatMoney(slice.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
