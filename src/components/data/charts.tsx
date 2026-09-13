"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/format";

/**
 * Charts.
 *
 * A chart is only ever drawn from points the simulator actually recorded: every
 * portfolio snapshot and every sampled price. There is no interpolation and no
 * synthetic history, so an account with two snapshots shows two points and the
 * panels above it say why.
 */

type SeriesPoint = { at: string; value: number };

function formatAxisTime(iso: string, spanMs: number): string {
  const date = new Date(iso);
  if (spanMs > 1000 * 60 * 60 * 36) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Tooltip styling, applied through recharts' own props rather than a custom
 * content component: recharts' content typing is generic over the payload shape
 * and fighting it produces more noise than value.
 */
const TOOLTIP_CONTENT_STYLE: React.CSSProperties = {
  background: "#141516",
  border: "1px solid #23252a",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};

const TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: "#62666d",
  fontSize: 11,
  marginBottom: 2,
};

const TOOLTIP_ITEM_STYLE: React.CSSProperties = {
  color: "#f7f8f8",
  padding: 0,
};

function formatTooltipLabel(label: React.ReactNode): string {
  const value = String(label ?? "");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function niceDomain(values: number[], include?: number | null): [number, number] {
  const all = include === null || include === undefined ? values : [...values, include];
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.02 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

export function PortfolioChart({
  snapshots,
  initialCapital,
  height = 220,
}: {
  snapshots: Array<{ capturedAt: string; totalValue: number }>;
  initialCapital?: number | null;
  height?: number;
}) {
  const data: SeriesPoint[] = React.useMemo(
    () =>
      snapshots.map((snapshot) => ({
        at: snapshot.capturedAt,
        value: snapshot.totalValue,
      })),
    [snapshots],
  );

  const spanMs = React.useMemo(() => {
    if (data.length < 2) return 0;
    return (
      new Date(data[data.length - 1].at).getTime() -
      new Date(data[0].at).getTime()
    );
  }, [data]);

  const domain = React.useMemo(
    () => niceDomain(data.map((point) => point.value), initialCapital ?? null),
    [data, initialCapital],
  );

  const positive =
    data.length >= 2 ? data[data.length - 1].value >= data[0].value : true;
  const stroke = positive ? "var(--pos)" : "var(--neg)";

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="portfolio-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--hairline)"
            strokeDasharray="0"
            vertical={false}
          />
          <XAxis
            dataKey="at"
            tickFormatter={(value: string) => formatAxisTime(value, spanMs)}
            stroke="var(--hairline-strong)"
            tick={{ fill: "var(--ink-tertiary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            domain={domain}
            stroke="var(--hairline-strong)"
            tick={{ fill: "var(--ink-tertiary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(value: number) =>
              value >= 10000
                ? `$${(value / 1000).toFixed(0)}k`
                : `$${value.toFixed(0)}`
            }
          />
          {initialCapital ? (
            <ReferenceLine
              y={initialCapital}
              stroke="var(--hairline-tertiary)"
              strokeDasharray="4 4"
            />
          ) : null}
          <Tooltip
            cursor={{ stroke: "var(--hairline-strong)" }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            formatter={(value) => [formatMoney(Number(value)), "Value"]}
            labelFormatter={formatTooltipLabel}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.75}
            fill="url(#portfolio-fill)"
            dot={data.length <= 40 ? { r: 2, fill: stroke, strokeWidth: 0 } : false}
            activeDot={{ r: 3.5 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PriceChart({
  points,
  height = 200,
  assetType,
}: {
  points: Array<{ capturedAt: string; price: number }>;
  height?: number;
  assetType: "stock" | "crypto";
}) {
  const data: SeriesPoint[] = React.useMemo(
    () => points.map((point) => ({ at: point.capturedAt, value: point.price })),
    [points],
  );

  const spanMs = React.useMemo(() => {
    if (data.length < 2) return 0;
    return (
      new Date(data[data.length - 1].at).getTime() - new Date(data[0].at).getTime()
    );
  }, [data]);

  const domain = React.useMemo(
    () => niceDomain(data.map((point) => point.value)),
    [data],
  );

  const positive =
    data.length >= 2 ? data[data.length - 1].value >= data[0].value : true;
  const stroke = positive ? "var(--pos)" : "var(--neg)";

  const formatPriceValue = (value: number) =>
    assetType === "crypto" && value < 1
      ? value.toFixed(6)
      : value.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.2} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--hairline)" vertical={false} />
          <XAxis
            dataKey="at"
            tickFormatter={(value: string) => formatAxisTime(value, spanMs)}
            stroke="var(--hairline-strong)"
            tick={{ fill: "var(--ink-tertiary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            domain={domain}
            stroke="var(--hairline-strong)"
            tick={{ fill: "var(--ink-tertiary)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={68}
            tickFormatter={formatPriceValue}
          />
          <Tooltip
            cursor={{ stroke: "var(--hairline-strong)" }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            formatter={(value) => [formatPriceValue(Number(value)), "Price"]}
            labelFormatter={formatTooltipLabel}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.75}
            fill="url(#price-fill)"
            dot={data.length <= 40 ? { r: 2, fill: stroke, strokeWidth: 0 } : false}
            activeDot={{ r: 3.5 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
