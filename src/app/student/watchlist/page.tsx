import { AssetSearch } from "@/components/market/asset-search";
import { WatchlistPanel } from "@/components/market/watchlist-panel";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { getStudentWorkspace } from "@/lib/auth/context";
import { loadWatchlist } from "@/lib/data/queries";
import { getQuotes } from "@/lib/market/service";

export default async function StudentWatchlistPage() {
  const { classroom, session } = await getStudentWorkspace();
  if (!classroom) return null;

  const entries = await loadWatchlist(classroom.id, session.userId);
  const { quotes, failures } = entries.length
    ? await getQuotes(entries.map((entry) => entry.asset.symbol))
    : { quotes: new Map(), failures: new Map<string, string>() };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-title font-medium text-ink">Watchlist</h1>
        <p className="mt-1.5 text-[12px] text-ink-tertiary">
          Assets you are tracking. Adding something here never buys it.
        </p>
      </header>

      <Panel className="p-4">
        <AssetSearch
          classroomId={classroom.id}
          placeholder="Search for an asset to add"
        />
      </Panel>

      <Panel>
        <PanelHeader
          title="Tracked assets"
          description={
            failures.size > 0
              ? `${failures.size} asset${failures.size === 1 ? "" : "s"} could not be priced right now.`
              : undefined
          }
        />
        <PanelBody className={entries.length === 0 ? "p-4" : "p-0"}>
          <WatchlistPanel
            classroomId={classroom.id}
            entries={entries}
            quotes={quotes}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
