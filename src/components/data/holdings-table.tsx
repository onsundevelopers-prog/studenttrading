import { Coins } from "lucide-react";
import Link from "next/link";

import { AssetMark, PriceChange } from "@/components/data/atoms";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  EmptyState,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import {
  formatMoney,
  formatPrice,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Holding } from "@/lib/types";

export function HoldingsTable({
  holdings,
  assetHrefPrefix,
  showCost = true,
}: {
  holdings: Holding[];
  /** When set, each row links to the asset's trade page. */
  assetHrefPrefix?: string;
  showCost?: boolean;
}) {
  if (holdings.length === 0) {
    return (
      <EmptyState
        icon={<Coins className="size-5" />}
        title="Your portfolio is empty."
        description="Search the market to find an asset to trade."
        action={
          assetHrefPrefix ? (
            <Button asChild size="sm" variant="secondary">
              <Link href="/student/market">Browse the market</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th className="pl-4">Asset</Th>
          <Th align="right">Quantity</Th>
          {showCost ? <Th align="right">Avg cost</Th> : null}
          <Th align="right">Last</Th>
          <Th align="right">Market value</Th>
          <Th align="right">Unrealised</Th>
          <Th align="right" className="pr-4">
            Allocation
          </Th>
        </tr>
      </thead>
      <tbody>
        {holdings.map((holding) => {
          const total = holdings.reduce((sum, item) => sum + item.marketValue, 0);
          const allocation = total > 0 ? (holding.marketValue / total) * 100 : 0;

          return (
            <Tr key={holding.assetId}>
              <Td className="pl-4">
                {assetHrefPrefix ? (
                  <Link
                    href={`${assetHrefPrefix}/${encodeURIComponent(holding.symbol)}`}
                    className="flex min-w-0 items-center gap-2.5 outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <AssetMark
                      symbol={holding.displaySymbol}
                      assetType={holding.assetType}
                    />
                    <span className="min-w-0">
                      <span className="block max-w-[220px] truncate text-[13px] text-ink">
                        {holding.name}
                      </span>
                      <span className="block font-mono text-[11px] text-ink-tertiary">
                        {holding.symbol}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <div className="flex min-w-0 items-center gap-2.5">
                    <AssetMark
                      symbol={holding.displaySymbol}
                      assetType={holding.assetType}
                    />
                    <span className="min-w-0">
                      <span className="block max-w-[220px] truncate text-[13px] text-ink">
                        {holding.name}
                      </span>
                      <span className="block font-mono text-[11px] text-ink-tertiary">
                        {holding.symbol}
                      </span>
                    </span>
                  </div>
                )}
              </Td>
              <Td align="right" className="text-ink">
                {formatQuantity(holding.quantity, holding.assetType)}
              </Td>
              {showCost ? (
                <Td align="right" className="text-ink-subtle">
                  {formatPrice(holding.avgCost, holding.assetType)}
                </Td>
              ) : null}
              <Td align="right">
                <span className="text-ink-muted">
                  {formatPrice(holding.lastPrice, holding.assetType)}
                </span>
                {holding.priceStale ? (
                  <span
                    title="No live price has been sampled for this asset yet, so the cost basis is shown."
                    className="ml-1 cursor-help text-[11px] text-warn"
                  >
                    •
                  </span>
                ) : null}
              </Td>
              <Td align="right" className="font-medium text-ink">
                {formatMoney(holding.marketValue)}
              </Td>
              <Td align="right">
                <div className="flex flex-col items-end gap-0.5">
                  <span
                    className={cn(
                      "num",
                      holding.unrealizedPnl > 0
                        ? "text-pos"
                        : holding.unrealizedPnl < 0
                          ? "text-neg"
                          : "text-ink-subtle",
                    )}
                  >
                    {formatSignedMoney(holding.unrealizedPnl)}
                  </span>
                  <span className="num text-[11px] text-ink-tertiary">
                    {formatSignedPercent(holding.unrealizedPnlPct)}
                  </span>
                </div>
              </Td>
              <Td align="right" className="pr-4">
                <span className="num text-ink-subtle">
                  {allocation.toFixed(1)}%
                </span>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

/** Compact single-line view used inside the leaderboard drill-down. */
export function HoldingSummaryRow({
  holding,
  href,
}: {
  holding: Holding;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-2"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <AssetMark symbol={holding.displaySymbol} assetType={holding.assetType} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-ink">{holding.name}</span>
          <span className="block num text-[11px] text-ink-tertiary">
            {formatQuantity(holding.quantity, holding.assetType)} @{" "}
            {formatPrice(holding.avgCost, holding.assetType)}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block num text-[13px] text-ink">
          {formatMoney(holding.marketValue)}
        </span>
        <PriceChange
          percent={holding.unrealizedPnlPct}
          showArrow={false}
          size="sm"
          className="justify-end"
        />
      </span>
    </Link>
  );
}
