import Link from "next/link";

import { ChangePill } from "@/components/data/atoms";
import { MarketList, type MarketRow } from "@/components/data/market-list";
import { MoverTable } from "@/components/data/mover-table";
import { AssetSearch } from "@/components/market/asset-search";
import { Button } from "@/components/ui/button";
import {
  Badge,
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui/primitives";
import { getStudentWorkspace } from "@/lib/auth/context";
import {
  loadClassroomAssetIds,
  loadCryptoAssets,
  loadPriceHistoryForAssets,
  loadTradeableAssets,
} from "@/lib/data/queries";
import {
  getMarketMovers,
  getQuotes,
  isMarketDataConfigured,
  MARKET_UNCONFIGURED_MESSAGE,
  type MoverQuote,
} from "@/lib/market/service";
import { getEquityMarketStatus } from "@/lib/market/market-status";
import { formatDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One broad-market ETF, as an index proxy rather than the index itself. */
function IndexTile({ row }: { row: MoverQuote }) {
  return (
    <Link
      href={`/student/market/${encodeURIComponent(row.symbol)}`}
      className="rounded-md border border-hairline bg-surface-2 px-3 py-2.5 outline-none transition-colors hover:border-hairline-strong focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[12px] font-medium text-ink">
          {row.displaySymbol}
        </span>
        <ChangePill change={row.change} percent={row.changePercent} />
      </div>
      <p className="mt-1.5 truncate text-[11px] text-ink-tertiary">{row.name}</p>
      <p className="num mt-1 text-[16px] font-medium text-ink">
        {formatPrice(row.price, "stock")}
      </p>
    </Link>
  );
}

const PAGE_SIZE = 24;

const TABS = [
  { key: "all", label: "All assets" },
  { key: "stock", label: "Stocks & ETFs" },
  { key: "crypto", label: "Crypto" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function StudentMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const { classroom, settings } = await getStudentWorkspace();
  if (!classroom) return null;

  const params = await searchParams;
  const tab: TabKey =
    params.type === "stock" || params.type === "crypto" ? params.type : "all";
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const universe =
    tab === "crypto" ? await loadCryptoAssets(200) : await loadTradeableAssets(300);
  const filtered =
    tab === "stock"
      ? universe.filter((asset) => asset.assetType === "stock")
      : universe;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const configured = isMarketDataConfigured();

  // The overview board, the index strip and the market clock are independent of
  // the browser below, so they resolve together. The whole board costs one
  // batched snapshot call because the index ETFs are part of the universe.
  const [quotesResult, movers, marketStatus, history] = await Promise.all([
    configured
      ? getQuotes(visible.map((asset) => asset.symbol))
      : Promise.resolve({
          quotes: new Map<string, never>(),
          failures: new Map<string, string>(),
        }),
    configured ? getMarketMovers({ limit: 5 }) : Promise.resolve(null),
    configured ? getEquityMarketStatus() : Promise.resolve(null),
    loadPriceHistoryForAssets(visible.map((asset) => asset.id), 48),
  ]);
  const { quotes, failures } = quotesResult;

  // Null means "no allow-list", which is different from an empty allow-list.
  const permitted =
    settings?.assetPolicy === "allowlist"
      ? new Set(await loadClassroomAssetIds(classroom.id))
      : null;

  const rows: MarketRow[] = visible.map((asset) => ({
    asset,
    quote: quotes.get(asset.symbol) ?? null,
    history: history.get(asset.id) ?? [],
    permitted: permitted === null ? true : permitted.has(asset.id),
    failureReason: failures.get(asset.symbol),
  }));

  const failureCount = failures.size;

  function hrefFor(nextTab: TabKey, nextPage: number) {
    const search = new URLSearchParams();
    if (nextTab !== "all") search.set("type", nextTab);
    if (nextPage > 1) search.set("page", String(nextPage));
    const query = search.toString();
    return `/student/market${query ? `?${query}` : ""}`;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-title font-medium text-ink">Market</h1>
        <p className="mt-1.5 text-[12px] text-ink-tertiary">
          Live prices for US stocks, ETFs and major crypto pairs, fetched from our
          market data source. Nothing on this page is invented or estimated.
        </p>
      </header>

      <Panel className="p-4">
        <AssetSearch classroomId={classroom.id} />
      </Panel>

      {movers ? (
        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="Market overview"
              description={
                movers.asOf
                  ? `Prices checked at ${formatDateTime(movers.asOf)}${
                      movers.failed > 0
                        ? ` · ${movers.failed} of the companies checked could not be priced`
                        : ""
                    }`
                  : undefined
              }
              action={
                marketStatus ? (
                  <Badge
                    tone={
                      marketStatus.session === "regular"
                        ? "pos"
                        : marketStatus.session === "closed"
                          ? "neg"
                          : "warn"
                    }
                  >
                    {marketStatus.label}
                  </Badge>
                ) : null
              }
            />
            <PanelBody>
              {movers.indexes.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {movers.indexes.map((row) => (
                    <IndexTile key={row.symbol} row={row} />
                  ))}
                </div>
              ) : (
                <Notice tone="neutral">
                  The market index funds could not be priced right now, so none
                  are shown. Nothing made-up is displayed in their place.
                </Notice>
              )}
            </PanelBody>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-3">
            <MoverTable
              title="Biggest Gains Today"
              description="The largest price rises among the companies we checked today."
              rows={movers.gainers}
              metric="dayRange"
              assetHrefPrefix="/student/market"
              emptyDescription="No company we checked is up in price today."
            />
            <MoverTable
              title="Biggest Losses Today"
              description="The largest price falls among the companies we checked today."
              rows={movers.losers}
              metric="dayRange"
              assetHrefPrefix="/student/market"
              emptyDescription="No company we checked is down in price today."
            />
            <MoverTable
              title="Most Traded Today"
              description="Ranked by the total value of shares traded today."
              rows={movers.mostActive}
              metric="turnover"
              assetHrefPrefix="/student/market"
              emptyDescription="No trading volume was reported for the companies we checked today."
            />
          </div>
        </div>
      ) : null}

      {!configured ? (
        <Notice tone="neg">{MARKET_UNCONFIGURED_MESSAGE}</Notice>
      ) : failureCount > 0 ? (
        <Notice tone="warn">
          {failureCount} of {visible.length} investments could not be priced right
          now. They are listed below without a price, rather than with a made-up
          one.
        </Notice>
      ) : null}

      <Panel>
        <PanelHeader
          title={
            <span className="flex items-center gap-2">
              {TABS.find((item) => item.key === tab)?.label}
              <Badge tone="outline">{filtered.length}</Badge>
            </span>
          }
          description={
            history.size > 0
              ? "The mini charts are drawn from prices this simulator has recorded over the last 48 hours."
              : "Mini charts will appear as prices are recorded over time."
          }
          action={
            <div className="flex items-center gap-1.5">
              {TABS.map((item) => (
                <Link
                  key={item.key}
                  href={hrefFor(item.key, 1)}
                  className={cn(
                    "rounded-full border px-2.5 py-[3px] text-[11px] transition-colors",
                    item.key === tab
                      ? "border-brand/45 bg-brand/15 text-[#a8b1ff]"
                      : "border-hairline bg-surface-2 text-ink-subtle hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          }
        />

        <MarketList
          rows={rows}
          assetHrefPrefix="/student/market"
          emptyTitle="No investments are available here yet."
          emptyDescription="Nothing has been added to this classroom's market list. Ask your teacher to check the classroom settings."
        />

        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
            <span className="text-[12px] text-ink-tertiary">
              Page {safePage} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                asChild
                size="sm"
                variant="secondary"
                aria-disabled={safePage === 1}
                className={safePage === 1 ? "pointer-events-none opacity-40" : undefined}
              >
                <Link href={hrefFor(tab, safePage - 1)}>Previous</Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant="secondary"
                aria-disabled={safePage === totalPages}
                className={
                  safePage === totalPages ? "pointer-events-none opacity-40" : undefined
                }
              >
                <Link href={hrefFor(tab, safePage + 1)}>Next</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      {rows.length === 0 ? (
        <Panel>
          <PanelBody>
            <EmptyState
              title="Nothing to show here."
              description="Try a different filter, or use the search box above to look up a company by name or ticker symbol."
            />
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
