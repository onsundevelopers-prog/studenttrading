import { getEquityMarketStatus, type MarketStatus } from "@/lib/market/market-status";
import { Badge } from "@/components/ui/primitives";

/** Small status chip for the top bar: real session state from Alpaca's clock. */
export async function MarketStatusBadge() {
  const status = await getEquityMarketStatus();
  const tone =
    status.session === "regular"
      ? "pos"
      : status.session === "closed"
        ? "neg"
        : "warn";
  return <Badge tone={tone}>{status.label}</Badge>;
}

/** Inline banner for pages where order placement must respect the session. */
export async function MarketStatusBanner({ assetType }: { assetType: "stock" | "crypto" }) {
  let status: MarketStatus;
  if (assetType === "crypto") {
    status = {
      session: "regular",
      isEquity: false,
      tradingAllowed: true,
      label: "Crypto · 24/7",
      nextChangeAt: null,
      source: "local",
    };
  } else {
    status = await getEquityMarketStatus();
  }

  if (status.tradingAllowed) return null;

  return (
    <div className="rounded-md border border-warn/35 bg-warn/8 px-3 py-2 text-[12px] leading-relaxed text-warn">
      {status.isEquity
        ? `The US equity market is closed (${status.label.toLowerCase()}). Crypto still trades 24/7.`
        : status.label}
    </div>
  );
}
