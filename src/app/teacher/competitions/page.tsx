import { Trophy } from "lucide-react";

import { PercentCell } from "@/components/data/atoms";
import { CompetitionForm } from "@/components/teacher/competition-form";
import { RefreshMarketButton } from "@/components/teacher/teacher-controls";
import {
  Badge,
  DataTable,
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { getTeacherWorkspace } from "@/lib/auth/context";
import {
  loadCompetitions,
  loadHeldSymbols,
  loadPriceFreshness,
} from "@/lib/data/queries";
import { getQuotes } from "@/lib/market/service";
import {
  formatDateTime,
  formatMoney,
  formatSignedMoney,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function TeacherCompetitionsPage() {
  const { classroom } = await getTeacherWorkspace();
  if (!classroom) return null;

  const freshness = await loadPriceFreshness();
  if (freshness.stale) {
    const symbols = await loadHeldSymbols(classroom.id);
    if (symbols.length > 0) await getQuotes(symbols);
  }

  const competitions = await loadCompetitions(classroom.id, true);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium text-ink">Competitions</h1>
          <p className="mt-1.5 text-[12px] text-ink-tertiary">
            Time-boxed contests. Each entrant is baselined at their portfolio
            value when the competition is created, so the standings measure
            performance over the window rather than since the start of term.
          </p>
        </div>
        <RefreshMarketButton classroomId={classroom.id} />
      </header>

      <CompetitionForm classroomId={classroom.id} />

      {competitions.length === 0 ? (
        <Panel>
          <PanelBody>
            <EmptyState
              icon={<Trophy className="size-5" />}
              title="No competitions yet."
              description="Create one above to run a ranked contest alongside the ongoing simulation."
            />
          </PanelBody>
        </Panel>
      ) : (
        competitions.map((competition) => (
          <Panel key={competition.id}>
            <PanelHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {competition.name}
                  <Badge
                    tone={
                      competition.status === "active"
                        ? "pos"
                        : competition.status === "upcoming"
                          ? "brand"
                          : "neutral"
                    }
                  >
                    {competition.status === "active"
                      ? "Running"
                      : competition.status === "upcoming"
                        ? "Scheduled"
                        : "Ended"}
                  </Badge>
                </span>
              }
              description={`${formatDateTime(competition.startsAt)} → ${formatDateTime(competition.endsAt)}${
                competition.description ? ` · ${competition.description}` : ""
              }`}
            />
            {competition.standings.length === 0 ? (
              <PanelBody>
                <EmptyState
                  title="No entrants."
                  description="Students enrolled when the competition is created are entered automatically."
                />
              </PanelBody>
            ) : (
              <DataTable>
                <thead>
                  <tr>
                    <Th className="w-12 pl-4">Rank</Th>
                    <Th>Student</Th>
                    <Th align="right">Opening value</Th>
                    <Th align="right">Current value</Th>
                    <Th align="right">Change</Th>
                    <Th align="right">Return</Th>
                    <Th align="right" className="pr-4">
                      Trades
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {competition.standings.map((standing) => (
                    <Tr key={standing.studentId}>
                      <Td className="pl-4">
                        <span
                          className={cn(
                            "num inline-flex h-6 w-6 items-center justify-center rounded-md border text-[12px]",
                            standing.rank === 1
                              ? "border-brand/45 bg-brand/15 text-[#a8b1ff]"
                              : "border-hairline bg-surface-2 text-ink-subtle",
                          )}
                        >
                          {standing.rank}
                        </span>
                      </Td>
                      <Td className="text-ink">{standing.label}</Td>
                      <Td align="right" className="text-ink-subtle">
                        {formatMoney(standing.openingValue)}
                      </Td>
                      <Td align="right" className="font-medium text-ink">
                        {formatMoney(standing.currentValue)}
                      </Td>
                      <Td align="right">
                        <span
                          className={cn(
                            "num",
                            standing.returnAbs > 0
                              ? "text-pos"
                              : standing.returnAbs < 0
                                ? "text-neg"
                                : "text-ink-subtle",
                          )}
                        >
                          {formatSignedMoney(standing.returnAbs)}
                        </span>
                      </Td>
                      <Td align="right">
                        <PercentCell value={standing.returnPct} />
                      </Td>
                      <Td align="right" className="pr-4 text-ink-subtle">
                        {standing.tradeCount}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
