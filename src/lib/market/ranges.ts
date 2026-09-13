/**
 * Chart ranges — shared by the server (which picks a provider timeframe per
 * range) and the client (which renders the range selector).
 *
 * This module must stay free of server-only imports: it is pulled into the
 * browser bundle, and `next build` fails loudly if a secret-bearing module
 * leaks into client code.
 */

export type ChartRange = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX";

export const CHART_RANGES: readonly ChartRange[] = [
  "1D",
  "5D",
  "1M",
  "3M",
  "6M",
  "1Y",
  "5Y",
  "MAX",
];

export const DEFAULT_CHART_RANGE: ChartRange = "1M";

export function isChartRange(value: unknown): value is ChartRange {
  return typeof value === "string" && (CHART_RANGES as readonly string[]).includes(value);
}

/** "MAX" reads better as "Max" beside the numeric ranges. */
export function rangeLabel(range: ChartRange): string {
  return range === "MAX" ? "Max" : range;
}
