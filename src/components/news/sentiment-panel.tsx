import { formatRelative } from "@/lib/format";
import type { SentimentDistribution } from "@/lib/news/service";

/**
 * News sentiment.
 *
 * The distribution is counted from the news source's own per-article labels — it
 * is a tally of what that source said, not a model of our own. It is labelled with
 * the number of articles it was counted from so nobody reads a 100% figure
 * drawn from a single headline as a market signal.
 *
 * Sentiment here is informational. It never reaches the trading engine, and the
 * engine has no code path that could act on it.
 */

const ROWS: ReadonlyArray<{
  key: "positive" | "neutral" | "negative";
  label: string;
  color: string;
}> = [
  { key: "positive", label: "Positive", color: "var(--pos)" },
  { key: "neutral", label: "Neutral", color: "var(--ink-subtle)" },
  { key: "negative", label: "Negative", color: "var(--neg)" },
];

export function SentimentPanel({
  distribution,
  fetchedAt,
  title = "News sentiment",
  description,
}: {
  distribution: SentimentDistribution;
  fetchedAt: string | null;
  title?: string;
  description?: string;
}) {
  if (distribution.total === 0) {
    return (
      <div className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="text-[13px] font-medium text-ink">{title}</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-tertiary">
          No articles were returned for this selection, so there is no sentiment
          to summarise. Nothing is estimated to fill the gap.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-medium text-ink">{title}</h2>
        <span className="num text-[11px] text-ink-tertiary">
          {distribution.total} article{distribution.total === 1 ? "" : "s"}
          {fetchedAt ? ` · updated ${formatRelative(fetchedAt)}` : ""}
        </span>
      </div>

      {description ? (
        <p className="mt-1 text-[12px] leading-snug text-ink-tertiary">{description}</p>
      ) : null}

      <div
        className="mt-3 flex h-2 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={ROWS.map(
          (row) => `${row.label} ${distribution.percents[row.key]}%`,
        ).join(", ")}
      >
        {ROWS.map((row) => (
          <span
            key={row.key}
            style={{
              width: `${distribution.percents[row.key]}%`,
              backgroundColor: row.color,
            }}
          />
        ))}
      </div>

      <dl className="mt-3 space-y-1.5">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 text-[12px]">
            <dt className="flex items-center gap-2 text-ink-muted">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ backgroundColor: row.color }}
              />
              {row.label}
            </dt>
            <dd className="num text-ink">
              {distribution.percents[row.key].toFixed(1)}%
              <span className="ml-2 text-ink-tertiary">
                {distribution.counts[row.key]}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {distribution.averageScore !== null ? (
        <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5 text-[12px]">
          <span className="text-ink-tertiary">Average Sentiment Score</span>
          <span className="num text-ink-muted">
            {distribution.averageScore >= 0 ? "+" : ""}
            {distribution.averageScore.toFixed(3)}
          </span>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-tertiary">
        Counted from the news source&apos;s own sentiment label on each article.
        Sentiment is background information only — it never places or influences a
        trade.
      </p>
    </div>
  );
}
