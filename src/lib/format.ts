/**
 * Formatting helpers.
 *
 * These are display-only. They never feed a calculation: every monetary figure
 * arrives from the database already computed in `numeric`.
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return usd.format(value);
}

/** Always carries an explicit sign, for P/L figures. */
export function formatSignedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${usd.format(Math.abs(value))}`;
}

export function formatPercent(
  value: number | null | undefined,
  options: { signed?: boolean; digits?: number } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const { signed = false, digits = 2 } = options;
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

export function formatSignedPercent(value: number | null | undefined): string {
  return formatPercent(value, { signed: true });
}

/**
 * Prices need more precision than money for crypto, but four decimals as a
 * blanket rule is over-precise for a $300 stock, so scale it.
 */
export function formatPrice(
  value: number | null | undefined,
  assetType?: "stock" | "crypto",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  let digits: number;
  if (assetType === "crypto" || abs < 1) digits = abs < 0.01 ? 6 : 4;
  else digits = 2;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Quantities drop trailing zeros: 10, not 10.00000000; 0.01000000 -> 0.01. */
export function formatQuantity(
  value: number | null | undefined,
  assetType?: "stock" | "crypto",
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const max = assetType === "crypto" ? 8 : 4;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: max,
  });
}

export function formatCompactMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  return formatMoney(value);
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateTime.format(new Date(value));
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateOnly.format(new Date(value));
}

/** "3m ago" style stamps for dense activity feeds. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "never";
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function formatAssetType(assetType: "stock" | "crypto"): string {
  return assetType === "crypto" ? "Crypto" : "Stock";
}

export function toneForValue(value: number | null | undefined): "pos" | "neg" | "flat" {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return "flat";
  return value > 0 ? "pos" : "neg";
}
