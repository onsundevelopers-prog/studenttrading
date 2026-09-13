"use client";

import { CandlestickChart, LineChart as LineChartIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";

import { formatPrice } from "@/lib/format";
import { CHART_RANGES, rangeLabel, type ChartRange } from "@/lib/market/ranges";
import type { HistoricalBar } from "@/lib/market/service";
import type { AssetType } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The price chart.
 *
 * Every point comes from real provider OHLCV bars — there is no interpolation
 * and no synthetic candle. Candlesticks are drawn as recharts range bars (a Bar
 * whose value is `[low, high]`) with a custom shape that derives the price
 * scale from the bar's own geometry, so the body, the wick and the axis always
 * agree.
 *
 * The range selector is a link, not local state: changing range changes which
 * provider timeframe is fetched, which is a server concern.
 */

type ChartDatum = HistoricalBar & { range: [number, number] };

const INTRADAY_RANGES: ReadonlySet<ChartRange> = new Set(["1D", "5D"]);
const BRUSH_RANGES: ReadonlySet<ChartRange> = new Set(["1Y", "5Y", "MAX"]);

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "#141516",
  border: "1px solid #23252a",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  minWidth: 168,
};

const ET = "America/New_York";

function formatBarTime(iso: string, intraday: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (intraday) {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: ET,
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: ET,
  });
}

function formatCompact(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

/**
 * One candlestick.
 *
 * Bar.js resolves an array value as a floating range, so `y` is the pixel of
 * the high and `height` spans down to the low. From those two anchors the price
 * scale is exact, which is what lets the body and wick be placed without
 * re-deriving the axis domain.
 */
function CandleShape(props: BarShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0 } = props;
  const datum = props.payload as ChartDatum | undefined;
  if (!datum) return <g />;

  const { open, close, high, low } = datum;
  const rising = close >= open;
  const color = rising ? "var(--pos)" : "var(--neg)";

  const centre = x + width / 2;
  const bodyWidth = Math.max(1, Math.min(width * 0.72, 18));
  const bodyX = centre - bodyWidth / 2;

  if (height <= 0 || high === low) {
    // A flat session still deserves a visible tick rather than nothing.
    return (
      <line
        x1={x}
        x2={x + Math.max(width, 1)}
        y1={y}
        y2={y}
        stroke={color}
        strokeWidth={1}
      />
    );
  }

  // px per unit of price, derived from the range bar's own geometry.
  const perUnit = height / (high - low);
  const priceToY = (value: number) => y - (value - high) * perUnit;

  const openY = priceToY(open);
  const closeY = priceToY(close);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(Math.abs(closeY - openY), 1);

  return (
    <g>
      <line
        x1={centre}
        x2={centre}
        y1={y}
        y2={y + height}
        stroke={color}
        strokeWidth={1}
      />
      <rect
        x={bodyX}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        fill={rising ? "transparent" : color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

function VolumeShape(props: BarShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0 } = props;
  const datum = props.payload as ChartDatum | undefined;
  if (!datum || height <= 0) return <g />;

  return (
    <rect
      x={x + Math.max((width - Math.max(width * 0.72, 1)) / 2, 0)}
      y={y}
      width={Math.max(width * 0.72, 1)}
      height={height}
      fill={datum.close >= datum.open ? "var(--pos-dim)" : "var(--neg-dim)"}
    />
  );
}

function OhlcTooltip({
  active,
  payload,
  assetType,
  intraday,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  assetType: AssetType;
  intraday: boolean;
}) {
  const datum = payload?.[0]?.payload as ChartDatum | undefined;
  if (!active || !datum) return null;

  const change = datum.close - datum.open;
  const changePercent = datum.open !== 0 ? (change / datum.open) * 100 : null;
  const tone =
    change > 0 ? "var(--pos)" : change < 0 ? "var(--neg)" : "var(--ink-subtle)";

  const rows: Array<[string, number]> = [
    ["Open", datum.open],
    ["High", datum.high],
    ["Low", datum.low],
    ["Close", datum.close],
  ];

  return (
    <div style={TOOLTIP_STYLE}>
      <p
        style={{
          color: "var(--ink-tertiary)",
          fontSize: 11,
          marginBottom: 6,
        }}
      >
        {formatBarTime(datum.time, intraday)} (New York time)
      </p>
      <dl style={{ display: "grid", gap: 3, margin: 0 }}>
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{ display: "flex", justifyContent: "space-between", gap: 14 }}
          >
            <dt style={{ color: "var(--ink-tertiary)" }}>{label}</dt>
            <dd
              className="num"
              style={{ margin: 0, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}
            >
              {formatPrice(value, assetType)}
            </dd>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
          <dt style={{ color: "var(--ink-tertiary)" }}>Change</dt>
          <dd
            className="num"
            style={{ margin: 0, color: tone, fontVariantNumeric: "tabular-nums" }}
          >
            {change >= 0 ? "+" : ""}
            {formatPrice(change, assetType)}
            {changePercent !== null
              ? ` (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)`
              : ""}
          </dd>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
          <dt style={{ color: "var(--ink-tertiary)" }}>Volume</dt>
          <dd
            className="num"
            style={{ margin: 0, color: "var(--ink-muted)", fontVariantNumeric: "tabular-nums" }}
          >
            {datum.volume > 0 ? formatCompact(datum.volume) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function PriceChartPanel({
  symbol,
  assetType,
  bars,
  range,
  rangeHref,
}: {
  symbol: string;
  assetType: AssetType;
  bars: HistoricalBar[];
  range: ChartRange;
  /** Builds the href for another range, so the page keeps its own query state. */
  rangeHref: (range: ChartRange) => string;
}) {
  const [mode, setMode] = React.useState<"candles" | "line">("candles");
  const intraday = INTRADAY_RANGES.has(range);

  const data = React.useMemo<ChartDatum[]>(
    () =>
      bars.map((bar) => ({
        ...bar,
        range: [bar.low, bar.high] as [number, number],
      })),
    [bars],
  );

  // The y domain is fixed here rather than left to auto-scaling, so toggling
  // between candles and a line never makes the price axis jump.
  const [domainMin, domainMax] = React.useMemo<[number, number]>(() => {
    if (data.length === 0) return [0, 1];
    const low = Math.min(...data.map((bar) => bar.low));
    const high = Math.max(...data.map((bar) => bar.high));
    const padding = (high - low) * 0.06 || Math.abs(high) * 0.01 || 1;
    return [low - padding, high + padding];
  }, [data]);

  const last = data[data.length - 1];
  const first = data[0];
  const periodChange =
    first && last ? last.close - first.open : 0;
  const lineStroke = periodChange >= 0 ? "var(--pos)" : "var(--neg)";

  const tickFormatter = React.useCallback(
    (value: string) =>
      intraday
        ? new Date(value).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: ET,
          })
        : new Date(value).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: ET,
          }),
    [intraday],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-0.5 rounded-md border border-hairline bg-surface-2 p-0.5"
          role="group"
          aria-label="Chart time range"
        >
          {CHART_RANGES.map((option) => (
            <Link
              key={option}
              href={rangeHref(option)}
              scroll={false}
              aria-current={option === range}
              className={cn(
                "num rounded-[4px] px-2 py-[3px] text-[11px] font-medium leading-none transition-colors",
                option === range
                  ? "bg-surface-4 text-ink"
                  : "text-ink-tertiary hover:text-ink-muted",
              )}
            >
              {rangeLabel(option)}
            </Link>
          ))}
        </div>

        <div
          className="flex items-center gap-0.5 rounded-md border border-hairline bg-surface-2 p-0.5"
          role="group"
          aria-label="Chart style"
        >
          {(
            [
              ["candles", CandlestickChart, "Candlesticks"],
              ["line", LineChartIcon, "Line"],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "rounded-[4px] p-1.5 transition-colors",
                mode === value
                  ? "bg-surface-4 text-ink"
                  : "text-ink-tertiary hover:text-ink-muted",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="h-[300px] w-full" data-testid="price-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            syncId={`chart-${symbol}`}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke="var(--hairline)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="time"
              hide
              tickFormatter={tickFormatter}
              domain={["dataMin", "dataMax"]}
            />
            <YAxis
              domain={[domainMin, domainMax]}
              stroke="var(--hairline-strong)"
              tick={{ fill: "var(--ink-tertiary)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={68}
              tickFormatter={(value: number) => formatPrice(value, assetType)}
            />
            <Tooltip
              content={<OhlcTooltip assetType={assetType} intraday={intraday} />}
              cursor={{ stroke: "var(--hairline-strong)", strokeWidth: 1 }}
            />

            {mode === "candles" ? (
              <Bar
                dataKey="range"
                shape={(props: BarShapeProps) => <CandleShape {...props} />}
                isAnimationActive={false}
                minPointSize={0}
                legendType="none"
              />
            ) : (
              <Line
                type="linear"
                dataKey="close"
                stroke={lineStroke}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="h-[88px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            syncId={`chart-${symbol}`}
            margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke="var(--hairline)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="time"
              tickFormatter={tickFormatter}
              tick={{ fill: "var(--ink-tertiary)", fontSize: 10 }}
              minTickGap={56}
              axisLine={{ stroke: "var(--hairline)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--ink-tertiary)", fontSize: 10 }}
              width={68}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => formatCompact(value)}
            />
            <Tooltip
              content={<OhlcTooltip assetType={assetType} intraday={intraday} />}
              cursor={{ stroke: "var(--hairline-strong)", strokeWidth: 1 }}
            />
            <Bar
              dataKey="volume"
              shape={(props: BarShapeProps) => <VolumeShape {...props} />}
              isAnimationActive={false}
            />
            {BRUSH_RANGES.has(range) ? (
              <Brush
                dataKey="time"
                height={18}
                travellerWidth={7}
                stroke="var(--hairline-strong)"
                fill="var(--surface-2)"
              />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-tertiary">
        {data.length.toLocaleString("en-US")} price bars from our market data
        source
        {range === "1D"
          ? " · the most recent trading session"
          : range === "5D"
            ? " · the five most recent trading sessions"
            : ""}
        {intraday ? " · times shown in New York time" : ""} · trading volume
        beneath. Every bar comes straight from the source; no series is
        interpolated or back-filled.
      </p>
    </div>
  );
}
