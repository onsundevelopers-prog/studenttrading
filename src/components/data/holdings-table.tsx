"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Coins, Search } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { AssetMark, PriceChange } from "@/components/data/atoms";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, Td, Th, Tr } from "@/components/ui/primitives";
import {
  formatMoney,
  formatPrice,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Holding } from "@/lib/types";

/**
 * The holdings table.
 *
 * Sorting and filtering happen here rather than in SQL because the portfolio is
 * already fully materialised by `get_portfolio` — a classroom portfolio is a few
 * dozen rows at most, so a round trip to re-sort it would be pure latency.
 *
 * The figures themselves are untouched: this component reorders and hides rows,
 * it never recomputes a value.
 */

type SortKey =
  | "symbol"
  | "quantity"
  | "avgCost"
  | "lastPrice"
  | "marketValue"
  | "unrealizedPnl"
  | "allocation";

type SortDirection = "asc" | "desc";

const DEFAULT_SORT: { key: SortKey; direction: SortDirection } = {
  key: "marketValue",
  direction: "desc",
};

function sortValue(holding: Holding, key: SortKey, total: number): number | string {
  switch (key) {
    case "symbol":
      return holding.symbol;
    case "quantity":
      return holding.quantity;
    case "avgCost":
      return holding.avgCost;
    case "lastPrice":
      return holding.lastPrice;
    case "marketValue":
      return holding.marketValue;
    case "unrealizedPnl":
      return holding.unrealizedPnl;
    case "allocation":
      return total > 0 ? holding.marketValue / total : 0;
  }
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "right",
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; direction: SortDirection };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.direction === "desc" ? ArrowDown : ArrowUp;

  return (
    <Th align={align} className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label.toLowerCase()}`}
        className={cn(
          "inline-flex items-center gap-1 font-medium transition-colors hover:text-ink",
          active ? "text-ink" : "text-ink-tertiary",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </Th>
  );
}

export function HoldingsTable({
  holdings,
  assetHrefPrefix,
  showCost = true,
  searchable = true,
}: {
  holdings: Holding[];
  /** When set, each row links to the asset's trade page. */
  assetHrefPrefix?: string;
  showCost?: boolean;
  searchable?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState(DEFAULT_SORT);

  const total = React.useMemo(
    () => holdings.reduce((sum, item) => sum + item.marketValue, 0),
    [holdings],
  );

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? holdings.filter(
          (holding) =>
            holding.symbol.toLowerCase().includes(needle) ||
            holding.displaySymbol.toLowerCase().includes(needle) ||
            holding.name.toLowerCase().includes(needle),
        )
      : holdings;

    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = sortValue(a, sort.key, total);
      const right = sortValue(b, sort.key, total);
      if (typeof left === "string" || typeof right === "string") {
        return String(left).localeCompare(String(right)) * direction;
      }
      return (left - right) * direction;
    });
  }, [holdings, query, sort, total]);

  function handleSort(key: SortKey) {
    setSort((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === "desc" ? "asc" : "desc" }
        : { key, direction: key === "symbol" ? "asc" : "desc" },
    );
  }

  if (holdings.length === 0) {
    return (
      <EmptyState
        icon={<Coins className="size-5" />}
        title="You don't own any investments yet."
        description="Search the market to find something to buy — everything you own will be listed here."
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
    <div>
      {searchable ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-ink-tertiary" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter your investments"
              aria-label="Filter your investments"
              className="h-8 w-[200px] rounded-md border border-hairline bg-surface-2 pl-8 pr-2 text-[12px] text-ink placeholder:text-ink-tertiary"
            />
          </label>
          <p className="num text-[11px] text-ink-tertiary">
            {rows.length === holdings.length
              ? `${holdings.length} investment${holdings.length === 1 ? "" : "s"}`
              : `${rows.length} of ${holdings.length} investments`}
          </p>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="Nothing matches that search."
            description="No investment in your portfolio matches what you typed."
          />
        </div>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <SortHeader
                label="Investment"
                sortKey="symbol"
                sort={sort}
                onSort={handleSort}
                align="left"
                className="pl-4"
              />
              <SortHeader
                label="Shares"
                sortKey="quantity"
                sort={sort}
                onSort={handleSort}
              />
              {showCost ? (
                <SortHeader
                  label="Average Price"
                  sortKey="avgCost"
                  sort={sort}
                  onSort={handleSort}
                />
              ) : null}
              <SortHeader
                label="Current Price"
                sortKey="lastPrice"
                sort={sort}
                onSort={handleSort}
              />
              <SortHeader
                label="Market Value"
                sortKey="marketValue"
                sort={sort}
                onSort={handleSort}
              />
              <SortHeader
                label="Potential Profit/Loss"
                sortKey="unrealizedPnl"
                sort={sort}
                onSort={handleSort}
              />
              <SortHeader
                label="Share of Portfolio"
                sortKey="allocation"
                sort={sort}
                onSort={handleSort}
                className="pr-4"
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((holding) => {
              const allocation =
                total > 0 ? (holding.marketValue / total) * 100 : 0;

              const cell = (
                <>
                  <span className="block max-w-[220px] truncate text-[13px] text-ink">
                    {holding.name}
                  </span>
                  <span className="block font-mono text-[11px] text-ink-tertiary">
                    {holding.symbol}
                  </span>
                </>
              );

              return (
                <Tr key={holding.assetId}>
                  <Td className="pl-4">
                    {assetHrefPrefix ? (
                      <Link
                        href={`${assetHrefPrefix}/${encodeURIComponent(holding.symbol)}`}
                        className="flex min-w-0 items-center gap-2.5 rounded-md outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <AssetMark
                          symbol={holding.displaySymbol}
                          assetType={holding.assetType}
                        />
                        <span className="min-w-0">{cell}</span>
                      </Link>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2.5">
                        <AssetMark
                          symbol={holding.displaySymbol}
                          assetType={holding.assetType}
                        />
                        <span className="min-w-0">{cell}</span>
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
                        title="No current price has been recorded for this investment yet, so the price you paid is shown instead."
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
                    <div className="flex flex-col items-end gap-1">
                      <span className="num text-ink-subtle">
                        {allocation.toFixed(1)}%
                      </span>
                      <span
                        aria-hidden
                        className="h-1 w-[56px] overflow-hidden rounded-full bg-surface-3"
                      >
                        <span
                          className="block h-full rounded-full bg-brand/70"
                          style={{ width: `${Math.min(allocation, 100)}%` }}
                        />
                      </span>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </div>
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
