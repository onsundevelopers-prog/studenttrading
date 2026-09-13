import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import { Badge } from "@/components/ui/primitives";
import {
  formatPercent,
  formatSignedMoney,
  formatSignedPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export function toneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
    return "text-ink-subtle";
  }
  return value > 0 ? "text-pos" : "text-neg";
}

export function toneBgClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
    return "bg-surface-2 text-ink-muted border-hairline";
  }
  return value > 0
    ? "bg-pos/12 text-pos border-pos/35"
    : "bg-neg/12 text-neg border-neg/35";
}

/**
 * The change indicator used throughout the terminal. Arrows carry the direction
 * as well as colour, so the information survives for colour-blind readers.
 */
export function PriceChange({
  change,
  percent,
  size = "md",
  showArrow = true,
  className,
}: {
  change?: number | null;
  percent?: number | null;
  size?: "sm" | "md";
  showArrow?: boolean;
  className?: string;
}) {
  const value =
    change !== null && change !== undefined ? change : (percent ?? null);
  const direction =
    value === null || value === undefined || Number.isNaN(value) || value === 0
      ? "flat"
      : value > 0
        ? "up"
        : "down";

  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 num font-medium",
        size === "sm" ? "text-[11px]" : "text-[12px]",
        toneClass(value),
        className,
      )}
    >
      {showArrow ? <Icon className={size === "sm" ? "size-3" : "size-3.5"} /> : null}
      {percent !== null && percent !== undefined ? formatSignedPercent(percent) : null}
      {change !== null && change !== undefined ? (
        <span className="text-ink-tertiary">
          {formatSignedMoney(change)}
        </span>
      ) : null}
    </span>
  );
}

export function DeltaPill({
  percent,
  className,
}: {
  percent: number | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[6px] border px-1.5 py-[3px] num text-[12px] font-medium",
        toneBgClass(percent),
        className,
      )}
    >
      {formatSignedPercent(percent)}
    </span>
  );
}

/**
 * The filled change pill used in quote rows (market list, watchlist).
 *
 * The daily move is stated as money — the figure a student actually cares about
 * — falling back to percent when the provider returns no absolute change. The
 * fill is solid rather than the tinted pill tables use, so a long list of quotes
 * can be scanned for winners and losers without reading a single number.
 */
export function ChangePill({
  change,
  percent,
  size = "sm",
  className,
}: {
  change?: number | null;
  percent?: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const value = change ?? percent ?? null;
  const flat = value === null || Number.isNaN(value) || value === 0;
  const label =
    change !== null && change !== undefined
      ? formatSignedMoney(change)
      : formatSignedPercent(percent);

  return (
    <span
      className={cn(
        "inline-flex min-w-[62px] items-center justify-center rounded-md num font-semibold",
        size === "sm" ? "px-1.5 py-[3px] text-[12px]" : "px-2 py-1 text-[13px]",
        flat
          ? "bg-surface-3 text-ink-muted"
          : value > 0
            ? "bg-pos text-on-pos"
            : "bg-neg text-on-neg",
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * A headline figure. Every metric on both dashboards is one of these, so the
 * vertical rhythm of the number + label is identical everywhere.
 */
export function MetricTile({
  label,
  value,
  hint,
  aside,
  tone,
  size = "md",
  className,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  aside?: React.ReactNode;
  tone?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  tooltip?: string;
}) {
  const valueSize =
    size === "lg"
      ? "text-[28px] leading-none"
      : size === "sm"
        ? "text-[15px] leading-none"
        : "text-[22px] leading-none";

  const toneApplied = tone !== undefined && tone !== null;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5">
        <p className="eyebrow truncate">{label}</p>
        {tooltip ? (
          <span
            title={tooltip}
            aria-label={tooltip}
            className="grid size-3.5 cursor-help place-items-center rounded-full border border-hairline-strong text-[9px] text-ink-tertiary"
          >
            ?
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            "num font-medium tracking-tight",
            valueSize,
            toneApplied ? toneClass(tone) : "text-ink",
          )}
        >
          {value}
        </span>
        {aside}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[12px] leading-snug text-ink-tertiary">{hint}</div>
      ) : null}
    </div>
  );
}

/** The ticker chip that precedes an asset name in tables and headers. */
export function AssetMark({
  symbol,
  assetType,
  className,
}: {
  symbol: string;
  assetType: "stock" | "crypto";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-[54px] items-center justify-center rounded-md border border-hairline bg-surface-2 px-1.5 font-mono text-[11px] font-medium tracking-tight",
        assetType === "crypto" ? "text-[#a8b1ff]" : "text-ink-muted",
        className,
      )}
    >
      {symbol}
    </span>
  );
}

export function AssetCell({
  symbol,
  displaySymbol,
  name,
  assetType,
  href,
}: {
  symbol: string;
  displaySymbol: string;
  name: string;
  assetType: "stock" | "crypto";
  href?: string;
}) {
  const content = (
    <span className="flex min-w-0 items-center gap-2.5">
      <AssetMark symbol={displaySymbol} assetType={assetType} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-ink">{name}</span>
        <span className="block truncate font-mono text-[11px] text-ink-tertiary">
          {symbol}
        </span>
      </span>
    </span>
  );

  if (!href) return content;

  return (
    <Link
      href={href}
      className="block min-w-0 rounded-md outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </Link>
  );
}

export function SideBadge({ side }: { side: "buy" | "sell" }) {
  return (
    <Badge tone={side === "buy" ? "pos" : "neg"}>
      {side === "buy" ? "Buy" : "Sell"}
    </Badge>
  );
}

export function PercentCell({
  value,
  signed = true,
  className,
}: {
  value: number | null | undefined;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("num", toneClass(value), className)}>
      {signed ? formatSignedPercent(value) : formatPercent(value)}
    </span>
  );
}

/** Used where a figure genuinely does not exist yet — never a fake zero. */
export function NotAvailable({ reason }: { reason: string }) {
  return (
    <span
      title={reason}
      className="cursor-help text-ink-tertiary"
      aria-label={reason}
    >
      —
    </span>
  );
}
