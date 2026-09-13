import { CircleAlert, CircleCheck } from "lucide-react";

import { Tooltip } from "@/components/ui/overlays";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Whether the prices on screen are current. Deliberately explicit: a trading
 * simulator that hides the age of its prices is lying by omission.
 */
export function PriceFreshness({
  fetchedAt,
  stale,
}: {
  fetchedAt: string | null;
  stale: boolean;
}) {
  if (!fetchedAt) {
    return (
      <span className="hidden items-center gap-1.5 text-[11px] text-ink-tertiary sm:flex">
        <CircleAlert className="size-3.5 text-warn" />
        No prices sampled yet
      </span>
    );
  }

  const label = formatRelative(fetchedAt);

  return (
    <Tooltip
      content={
        stale
          ? `The newest sampled price is from ${new Date(fetchedAt).toLocaleString()}. Use refresh to update it.`
          : `Prices were last sampled ${new Date(fetchedAt).toLocaleString()}.`
      }
    >
      <span
        className={cn(
          "hidden cursor-help items-center gap-1.5 text-[11px] sm:flex",
          stale ? "text-warn" : "text-ink-tertiary",
        )}
      >
        {stale ? (
          <CircleAlert className="size-3.5" />
        ) : (
          <CircleCheck className="size-3.5 text-pos" />
        )}
        Prices {label}
      </span>
    </Tooltip>
  );
}
