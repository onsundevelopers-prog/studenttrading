"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatPrice } from "@/lib/format";
import type { HistoricalBar } from "@/lib/market/service";

const TOOLTIP_CONTENT_STYLE: React.CSSProperties = {
  background: "#141516",
  border: "1px solid #23252a",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};

/**
 * Daily close line over real provider bars. OHLC candles were deliberately not
 * drawn: at classroom zoom levels a close line carries the same information
 * with far less ink, and the volume panel below completes the picture.
 */
export function BarChartPanel({
  bars,
  assetType,
}: {
  bars: HistoricalBar[];
  assetType: "stock" | "crypto";
}) {
  const data = React.useMemo(
    () =>
      bars.map((bar) => ({
        at: bar.time,
        close: bar.close,
      })),
    [bars],
  );

  const spanMs =
    new Date(data[data.length - 1]?.at ?? 0).getTime() -
    new Date(data[0]?.at ?? 0).getTime();

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Area_shim data={data} spanMs={spanMs} assetType={assetType} />
      </ResponsiveContainer>
    </div>
  );
}

/** Volume-by-day from real provider bars; recharts keeps this compact. */
export function VolumeChart({ bars }: { bars: HistoricalBar[] }) {
  const data = React.useMemo(
    () =>
      bars.map((bar) => ({
        at: bar.time,
        volume: bar.volume,
      })),
    [bars],
  );

  return (
    <div className="h-[120px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="#23252a" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="at"
            tickFormatter={(value: string) =>
              new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            }
            tick={{ fill: "#8b8f98", fontSize: 10 }}
            minTickGap={48}
            axisLine={{ stroke: "#23252a" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#8b8f98", fontSize: 10 }}
            width={54}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value: number) =>
              value >= 1e6
                ? `${(value / 1e6).toFixed(0)}M`
                : value >= 1e3
                  ? `${(value / 1e3).toFixed(0)}K`
                  : String(value)
            }
          />          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={{ color: "#c9ccd4" }}
            formatter={(value) => [Number(value).toLocaleString("en-US"), "Volume"]}
            labelFormatter={(label) =>
              new Date(String(label)).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            }
 />
          <Bar dataKey="volume" fill="#3d5a80" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// The close-line chart is imported lazily here to keep this module focused on
// bars/volume; the implementation is a thin AreaChart with the same styling as
// the existing PriceChart.
import { Area, AreaChart } from "recharts";

function Area_shim({
  data,
  spanMs,
  assetType,
}: {
  data: Array<{ at: string; close: number }>;
  spanMs: number;
  assetType: "stock" | "crypto";
}) {
  return (
    <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
      <defs>
        <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c93ff" stopOpacity={0.25} />
          <stop offset="100%" stopColor="#7c93ff" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke="#23252a" strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="at"
        tickFormatter={(value: string) =>
          spanMs > 1000 * 60 * 60 * 36
            ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        }
        tick={{ fill: "#8b8f98", fontSize: 10 }}
        minTickGap={48}
        axisLine={{ stroke: "#23252a" }}
        tickLine={false}
      />
      <YAxis
        domain={["auto", "auto"]}
        tick={{ fill: "#8b8f98", fontSize: 10 }}
        width={64}
        axisLine={false}
        tickLine={false}
        tickFormatter={(value: number) => formatPrice(value, assetType)}
      />
      <Tooltip
        contentStyle={TOOLTIP_CONTENT_STYLE}
        labelStyle={{ color: "#c9ccd4" }}
        formatter={(value) => [formatPrice(Number(value), assetType), "Close"]}
        labelFormatter={(label) =>
          new Date(String(label)).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        }
      />
      <Area
        type="monotone"
        dataKey="close"
        stroke="#7c93ff"
        strokeWidth={1.5}
        fill="url(#barFill)"
      />
    </AreaChart>
  );
}
