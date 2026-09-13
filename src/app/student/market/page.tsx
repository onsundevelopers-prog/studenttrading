import Link from "next/link";

import { MarketList, type MarketRow } from "@/components/data/market-list";
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
  getQuotes,
  isMarketDataConfigured,
  MARKET_UNCONFIGURED_MESSAGE,
} from "@/lib/market/service";
import { cn } from "@/lib/utils";

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
  const { quotes, failures } = configured
    ? await getQuotes(visible.map((asset) => asset.symbol))
    : { quotes: new Map(), failures: new Map<string, string>() };

  const history = await loadPriceHistoryForAssets(visible.map((asset) => asset.id), 48);

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
          Live prices for US stocks, ETFs and major crypto pairs. Every price here
          is fetched from the provider — nothing is simulated or estimated.
        </p>
      </header>

      <Panel className="p-4">
        <AssetSearch classroomId={classroom.id} />
      </Panel>

      {!configured ? (
        <Notice tone="neg">{MARKET_UNCONFIGURED_MESSAGE}</Notice>
      ) : failureCount > 0 ? (
        <Notice tone="warn">
          {failureCount} of {visible.length} assets could not be priced right now.
          They are listed below without a price rather than with a made-up one.
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
              ? "Sparklines are drawn from prices this simulator has sampled over the last 48 hours."
              : "Sparklines will appear as prices are sampled over time."
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
          emptyTitle="No assets available."
          emptyDescription="If you expected assets here, the asset universe has not been seeded — run the migration in supabase/migrations."
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
              title="No assets to show."
              description="Try a different filter."
            />
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
