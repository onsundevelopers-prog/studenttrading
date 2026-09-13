import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-hairline bg-surface-2 text-ink-muted",
        brand: "border-brand/40 bg-brand/15 text-[#a8b1ff]",
        pos: "border-pos/35 bg-pos/12 text-pos",
        neg: "border-neg/35 bg-neg/12 text-neg",
        warn: "border-warn/35 bg-warn/12 text-warn",
        outline: "border-hairline-strong bg-transparent text-ink-subtle",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Panel — the only "card" in the system: charcoal surface + hairline, 12px.
// ---------------------------------------------------------------------------
export function Panel({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-lg border border-hairline bg-surface-1",
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[13px] font-medium leading-tight text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-[12px] leading-snug text-ink-tertiary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function PanelBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-3", className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------
export function EmptyState({
  title,
  description,
  action,
  className,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-hairline-strong px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 text-ink-tertiary" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="text-[13px] font-medium text-ink-muted">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-ink-tertiary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-neg/35 bg-neg/8 px-4 py-3",
        className,
      )}
    >
      <p className="text-[13px] font-medium text-neg">{title}</p>
      {description ? (
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Compact inline notice for non-fatal problems, e.g. a stale price. */
export function Notice({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "warn" | "pos" | "neg" | "brand";
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-hairline bg-surface-2 text-ink-muted",
    warn: "border-warn/35 bg-warn/8 text-warn",
    pos: "border-pos/35 bg-pos/8 text-pos",
    neg: "border-neg/35 bg-neg/8 text-neg",
    brand: "border-brand/35 bg-brand/10 text-[#a8b1ff]",
  };
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-[12px] leading-relaxed",
        tones[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table shell — dense, hairline-separated rows.
// ---------------------------------------------------------------------------
export function DataTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-full border-collapse text-[13px]">
        {children}
      </table>
    </div>
  );
}

export function Th({
  className,
  align = "left",
  ...props
}: React.ComponentProps<"th"> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn(
        "eyebrow whitespace-nowrap px-3 py-2 font-medium",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  align = "left",
  ...props
}: React.ComponentProps<"td"> & { align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle",
        align === "right" && "num text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-t border-hairline transition-colors hover:bg-surface-2/70",
        className,
      )}
      {...props}
    />
  );
}
