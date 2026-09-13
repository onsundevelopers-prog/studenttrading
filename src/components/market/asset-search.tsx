"use client";

import { LoaderCircle, Lock, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type SearchHit = {
  symbol: string;
  displaySymbol: string;
  name: string;
  assetType: "stock" | "crypto";
  permitted: boolean;
};

/**
 * Market search.
 *
 * Talks to /api/market/search, which is authenticated and rate-limited
 * server-side. Results the classroom is not permitted to trade are marked, so a
 * student finds that out while browsing rather than after filling in an order.
 */
export function AssetSearch({
  classroomId,
  placeholder = "Search stocks and crypto — AAPL, bitcoin, TSLA",
  autoFocus = false,
}: {
  classroomId: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [state, setState] = React.useState<"idle" | "loading" | "error">("idle");
  const [reason, setReason] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const requestId = React.useRef(0);

  React.useEffect(() => {
    const trimmed = query.trim();
    // Clearing the results for an empty query happens in the change handler, not
    // here: a synchronous setState in an effect body causes an extra render pass
    // for no benefit.
    if (trimmed.length === 0) return;

    const handle = setTimeout(async () => {
      const current = ++requestId.current;
      setState("loading");
      try {
        const response = await fetch(
          `/api/market/search?q=${encodeURIComponent(trimmed)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as
          | { ok: true; hits: SearchHit[] }
          | { ok: false; reason: string };

        // A slower earlier request must not overwrite a newer result.
        if (current !== requestId.current) return;

        if (payload.ok) {
          setHits(payload.hits);
          setReason(null);
          setState("idle");
        } else {
          setHits([]);
          setReason(payload.reason);
          setState("error");
        }
        setOpen(true);
      } catch {
        if (current !== requestId.current) return;
        setHits([]);
        setReason("Market data is temporarily unavailable.");
        setState("error");
        setOpen(true);
      }
    }, 280);

    return () => clearTimeout(handle);
  }, [query]);

  React.useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const go = React.useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(
        `/student/market/${encodeURIComponent(hit.symbol)}?class=${classroomId}`,
      );
    },
    [classroomId, router],
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-tertiary"
        />
        <input
          type="search"
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="Search the market"
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (next.trim().length === 0) {
              setHits([]);
              setReason(null);
              setState("idle");
              setOpen(false);
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && hits.length > 0) {
              event.preventDefault();
              go(hits[0]);
            }
          }}
          className="h-9 w-full rounded-md border border-hairline bg-surface-1 pl-8 pr-8 text-[13px] text-ink placeholder:text-ink-tertiary focus:border-hairline-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-search-cancel-button]:hidden"
        />
        {state === "loading" ? (
          <LoaderCircle
            aria-hidden
            className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-ink-tertiary"
          />
        ) : query.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setHits([]);
              setReason(null);
              setState("idle");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-ink-tertiary hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {open && query.trim().length > 0 ? (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-[420px] overflow-y-auto rounded-lg border border-hairline bg-surface-2 p-1 shadow-xl shadow-black/50">
          {state === "error" ? (
            <p className="px-3 py-3 text-[12px] leading-relaxed text-warn">
              {reason}
            </p>
          ) : hits.length === 0 && state === "loading" ? (
            <p className="px-3 py-3 text-[12px] text-ink-tertiary">
              Searching…
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-[12px] leading-relaxed text-ink-tertiary">
              No assets matched “{query.trim()}”. Try a ticker symbol such as
              AAPL, or a name.
            </p>
          ) : (
            <ul>
              {hits.map((hit) => (
                <li key={`${hit.assetType}-${hit.symbol}`}>
                  <button
                    type="button"
                    onClick={() => go(hit)}
                    className="flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 text-left outline-none transition-colors hover:bg-surface-4 focus-visible:bg-surface-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px] font-medium text-ink">
                          {hit.displaySymbol}
                        </span>
                        {hit.assetType === "crypto" ? (
                          <Badge tone="outline" className="px-1.5 py-0 text-[10px]">
                            Crypto
                          </Badge>
                        ) : null}
                        {!hit.permitted ? (
                          <Badge tone="warn" className="gap-1 px-1.5 py-0 text-[10px]">
                            <Lock className="size-2.5" />
                            Not enabled
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-tertiary">
                        {hit.name}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[11px]",
                        hit.permitted ? "text-ink-tertiary" : "text-warn",
                      )}
                    >
                      {hit.symbol}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
