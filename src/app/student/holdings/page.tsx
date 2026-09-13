import Link from "next/link";

import { HoldingsTable } from "@/components/data/holdings-table";
import { PortfolioSummary } from "@/components/data/portfolio-summary";
import { Button } from "@/components/ui/button";
import { Notice, Panel, PanelHeader } from "@/components/ui/primitives";
import { refreshStudentMarketAction } from "@/lib/actions/market";
import { getStudentWorkspace } from "@/lib/auth/context";
import {
  loadHeldSymbols,
  loadPortfolio,
  loadPriceFreshness,
} from "@/lib/data/queries";
import { getQuotes } from "@/lib/market/service";

export default async function StudentHoldingsPage() {
  const { classroom, session } = await getStudentWorkspace();
  if (!classroom) return null;

  const freshness = await loadPriceFreshness();
  const symbols = await loadHeldSymbols(classroom.id);
  if (freshness.stale && symbols.length > 0) await getQuotes(symbols);

  const portfolio = await loadPortfolio(classroom.id, session.userId);
  if (!portfolio) return null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium text-ink">Holdings</h1>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            {portfolio.holdings.length} position
            {portfolio.holdings.length === 1 ? "" : "s"} · valued at the latest
            sampled market price
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={refreshStudentMarketAction}>
            <input type="hidden" name="classroomId" value={classroom.id} />
            <Button type="submit" size="sm" variant="secondary">
              Refresh prices
            </Button>
          </form>
          <Button asChild size="sm" variant="primary">
            <Link href="/student/market">Find something to buy</Link>
          </Button>
        </div>
      </header>

      <Panel className="px-5 py-4">
        <PortfolioSummary portfolio={portfolio} />
      </Panel>

      <Panel>
        <PanelHeader
          title="Positions"
          description="Cost basis is the weighted average of everything you bought, after sells."
        />
        <HoldingsTable
          holdings={portfolio.holdings}
          assetHrefPrefix="/student/market"
        />
      </Panel>

      {portfolio.pricesIncomplete ? (
        <Notice tone="warn">
          One or more positions have no sampled price yet, so their cost basis is
          shown instead of a market value. Use “Refresh prices” above.
        </Notice>
      ) : null}
    </div>
  );
}
