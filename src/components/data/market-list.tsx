import { ChartLine } from "lucide-react";
import Link from "next/link";

import { ChangePill } from "@/components/data/atoms";
import { Sparkline } from "@/components/data/sparkline";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/format";
import type { Asset, PricePoint, Quote } from "@/lib/types";

export type MarketRow = {
  asset: Asset;
  quote: Quote | null;
  history: PricePoint[];
  permitted?: boolean;
  failureReason?: string;
};

/**
 * The market list: one quote per row, in the order the eye reads a watchlist —
 * what it is, how it has moved, what it costs, and how much that is up or down
 * today. The change is stated as money in a filled pill because that is the
 * figure a student is actually trading on.
 *
 * A row with no price says so. It never shows a zero or a stale number
 * dressed up as current.
 */
export function MarketList({
  rows,
  assetHrefPrefix,
  emptyTitle = "No assets to show.",
  emptyDescription,
}: {
  rows: MarketRow[];
  assetHrefPrefix: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartLine className="size-5" />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <ul className="divide-y divide-hairline">
      {rows.map((row) => {
        const { asset, quote, history } = row;
        const blocked = row.permitted === false;

        return (
          <li key={asset.id}>
            <Link
              href={`${assetHrefPrefix}/${encodeURIComponent(asset.symbol)}`}
              className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold tracking-[-0.2px] text-ink">
                    {asset.displaySymbol}
                  </span>
                  {asset.assetType === "crypto" ? (
                    <Badge tone="outline" className="px-1.5 py-0 text-[10px]">
                      Crypto
                    </Badge>
                  ) : null}
                  {blocked ? (
                    <Badge tone="warn" className="px-1.5 py-0 text-[10px]">
                      Not enabled
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-subtle">
                  {asset.name}
                </span>
              </span>

              <span className="w-[68px] shrink-0 sm:w-[116px]">
                <Sparkline
                  fluid
                  height={30}
                  points={history.map((point) => point.price)}
                  ariaLabel={`${asset.displaySymbol} sampled price movement`}
                />
              </span>

              <span className="w-[92px] shrink-0 text-right sm:w-[112px]">
                {quote ? (
                  <>
                    <span className="block num text-[15px] font-semibold tracking-[-0.2px] text-ink">
                      {formatPrice(quote.price, asset.assetType)}
                    </span>
                    <span className="mt-1 block">
                      <ChangePill
                        change={quote.change}
                        percent={quote.changePercent}
                      />
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="block num text-[15px] font-semibold text-ink-tertiary"
                      title={row.failureReason ?? "No quote available"}
                    >
                      —
                    </span>
                    <span
                      className="mt-1 block text-[11px] text-ink-tertiary"
                      title={row.failureReason ?? "No quote available"}
                    >
                      unavailable
                    </span>
                  </>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
