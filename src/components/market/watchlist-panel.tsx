import { Bookmark, X } from "lucide-react";
import Link from "next/link";

import { ChangePill } from "@/components/data/atoms";
import {
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui/primitives";
import {
  addToWatchlistFormAction,
  removeWatchlistItemFormAction,
} from "@/lib/actions/watchlist";
import { formatPrice } from "@/lib/format";
import type { WatchlistEntry } from "@/lib/data/queries";
import type { Quote } from "@/lib/types";

/**
 * The watchlist. Removal is a server action scoped to the signed-in student's own
 * list, so an item id from somebody else's watchlist cannot be deleted by
 * crafting a request.
 */
export function WatchlistPanel({
  classroomId,
  entries,
  quotes,
  compact = false,
  hrefPrefix = "/student/market",
}: {
  classroomId: string;
  entries: WatchlistEntry[];
  quotes: Map<string, Quote>;
  compact?: boolean;
  hrefPrefix?: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Bookmark className="size-5" />}
        title="Your watchlist is empty."
        description="Open any company from the market and choose “Add to watchlist” to follow its price without buying it."
        action={
          <Link
            href="/student/market"
            className="text-[12px] text-ink-muted underline decoration-hairline-strong underline-offset-2 hover:text-ink"
          >
            Browse the market
          </Link>
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-hairline">
      {entries.map((entry) => {
        const quote = quotes.get(entry.asset.symbol);
        return (
          <li
            key={entry.itemId}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60"
          >
            <Link
              href={`${hrefPrefix}/${encodeURIComponent(entry.asset.symbol)}`}
              className="flex min-w-0 flex-1 items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold tracking-[-0.2px] text-ink">
                  {entry.asset.displaySymbol}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-subtle">
                  {entry.asset.name}
                </span>
              </span>
            </Link>

            <span className="shrink-0 text-right">
              {quote ? (
                <>
                  <span className="block num text-[14px] font-semibold tracking-[-0.2px] text-ink">
                    {formatPrice(quote.price, entry.asset.assetType)}
                  </span>
                  <span className="mt-1 block">
                    <ChangePill
                      change={quote.change}
                      percent={quote.changePercent}
                    />
                  </span>
                </>
              ) : (
                <>
                  <span className="block num text-[14px] font-semibold text-ink-tertiary">
                    —
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-tertiary">
                    no price
                  </span>
                </>
              )}
            </span>

            {compact ? null : (
              <form action={removeWatchlistItemFormAction}>
                <input type="hidden" name="classroomId" value={classroomId} />
                <input type="hidden" name="itemId" value={entry.itemId} />
                <button
                  type="submit"
                  aria-label={`Remove ${entry.asset.displaySymbol} from your watchlist`}
                  className="grid size-7 place-items-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-neg"
                >
                  <X className="size-3.5" />
                </button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function WatchlistCard(props: {
  classroomId: string;
  entries: WatchlistEntry[];
  quotes: Map<string, Quote>;
  compact?: boolean;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Watchlist"
        description="Companies you are following but don't own. Adding one here never buys it."
        action={
          <Link
            href="/student/watchlist"
            className="text-[12px] text-ink-subtle transition-colors hover:text-ink"
          >
            Manage
          </Link>
        }
      />
      <PanelBody className={props.entries.length === 0 ? "p-4" : "p-0"}>
        <WatchlistPanel {...props} />
      </PanelBody>
    </Panel>
  );
}

/** Small button used on the asset detail page. */
export function AddToWatchlistButton({
  classroomId,
  symbol,
  alreadyWatched,
}: {
  classroomId: string;
  symbol: string;
  alreadyWatched: boolean;
}) {
  if (alreadyWatched) {
    return (
      <span className="inline-flex h-8 items-center gap-2 rounded-md border border-hairline bg-surface-2 px-3 text-[13px] text-ink-subtle">
        <Bookmark className="size-3.5" />
        On your watchlist
      </span>
    );
  }

  return (
    <form action={addToWatchlistFormAction}>
      <input type="hidden" name="classroomId" value={classroomId} />
      <input type="hidden" name="symbol" value={symbol} />
      <button
        type="submit"
        className="inline-flex h-8 items-center gap-2 rounded-md border border-hairline bg-surface-2 px-3 text-[13px] text-ink transition-colors hover:border-hairline-strong hover:bg-surface-3"
      >
        <Bookmark className="size-3.5" />
        Add to watchlist
      </button>
    </form>
  );
}
