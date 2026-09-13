import { cn } from "@/lib/utils";

/**
 * A hand-rolled SVG sparkline.
 *
 * Deliberately not a charting-library component: the market list renders dozens
 * of these, and a polyline with a filled area is both far cheaper and crisper
 * than mounting a chart per row.
 *
 * One point is not a trend, so a single sample renders a flat marker rather
 * than an invented slope.
 */
export function Sparkline({
  points,
  width = 104,
  height = 28,
  fluid = false,
  className,
  ariaLabel,
}: {
  points: number[];
  width?: number;
  height?: number;
  /** Stretch to the container's width instead of a fixed size. */
  fluid?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  if (points.length === 0) {
    return (
      <span
        className={cn(
          "block text-[10px] leading-none text-ink-tertiary",
          className,
        )}
        style={fluid ? { height } : { width, height, lineHeight: `${height}px` }}
        aria-label="No price history collected yet"
      >
        no data
      </span>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const positive = last >= first;
  const stroke = positive ? "var(--pos)" : "var(--neg)";
  const gradientId = `spark-${positive ? "up" : "down"}`;

  // A fluid sparkline is scaled non-uniformly to fill its column, so strokes
  // must opt out of that scaling or they smear into wedges.
  const sizing = fluid
    ? ({ width: "100%", height, preserveAspectRatio: "none" } as const)
    : ({ width, height } as const);
  const svgClass = cn("block", fluid ? "w-full" : undefined, className);
  const strokeProps = fluid ? ({ vectorEffect: "non-scaling-stroke" } as const) : {};

  if (points.length === 1) {
    return (
      <svg
        {...sizing}
        viewBox={`0 0 ${width} ${height}`}
        className={svgClass}
        role="img"
        aria-label={ariaLabel ?? "One price sample collected"}
      >
        <line
          x1={width / 2 - 6}
          x2={width / 2 + 6}
          y1={height / 2}
          y2={height / 2}
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          {...strokeProps}
        />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || Math.abs(max) || 1;
  const pad = 3;
  const usableHeight = height - pad * 2;

  const coordinates = points.map((value, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = pad + (1 - (value - min) / span) * usableHeight;
    return [x, y] as const;
  });

  const line = coordinates
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const baselineY = pad + (1 - (first - min) / span) * usableHeight;

  return (
    <svg
      {...sizing}
      viewBox={`0 0 ${width} ${height}`}
      className={cn(svgClass, "overflow-visible")}
      role="img"
      aria-label={ariaLabel ?? "Intraday price movement"}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...strokeProps}
      />
      {!positive ? (
        <line
          x1="0"
          x2={width}
          y1={baselineY}
          y2={baselineY}
          stroke="var(--hairline-tertiary)"
          strokeWidth="1"
          strokeDasharray="3 3"
          {...strokeProps}
        />
      ) : null}
    </svg>
  );
}
