import Link from "next/link";

import { AllocationBar } from "@/components/data/allocation-bar";
import { HoldingsTable } from "@/components/data/holdings-table";
import { PortfolioSummary } from "@/components/data/portfolio-summary";
import { Button } from "@/components/ui/button";
import { Notice, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
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
          <h1 className="text-title font-medium text-ink">Your Investments</h1>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            {portfolio.holdings.length} investment
            {portfolio.holdings.length === 1 ? "" : "s"} · valued at the latest
            recorded price
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
          title="How Your Money Is Split"
          description="Each investment's share of your portfolio by market value, with your available cash included."
        />
        <PanelBody>
          <AllocationBar
            holdings={portfolio.holdings}
            cashBalance={portfolio.cashBalance}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Your Investments"
          description="Sort any column or filter by name. Average Price is what you paid on average for everything you own, allowing for anything you have already sold."
        />
        <HoldingsTable
          holdings={portfolio.holdings}
          assetHrefPrefix="/student/market"
        />
      </Panel>

      {portfolio.pricesIncomplete ? (
        <Notice tone="warn">
          One or more of your investments don&apos;t have a current price yet, so
          the price you paid is shown instead of its market value. Use
          &ldquo;Refresh prices&rdquo; above.
        </Notice>
      ) : null}
    </div>
  );
}
