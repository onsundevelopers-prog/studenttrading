import { ExternalLink, Newspaper } from "lucide-react";
import Link from "next/link";

import { Badge, EmptyState } from "@/components/ui/primitives";
import { formatRelative } from "@/lib/format";
import type { NewsArticle } from "@/lib/news/alphavantage";
import { cn } from "@/lib/utils";

/**
 * The news list.
 *
 * Every field on a row comes from the news source: headline, publisher,
 * timestamp, summary, associated tickers, sentiment and image. Nothing is
 * generated, and an article that arrived without a publisher or a timestamp is
 * not dressed up to look complete.
 *
 * Links open the publisher's own page in a new tab. Images are plain <img>
 * rather than next/image because publisher CDNs are arbitrary hosts and this app
 * does not proxy or re-host third-party content.
 */

function sentimentTone(score: number): "pos" | "neg" | "neutral" {
  if (score > 0.15) return "pos";
  if (score < -0.15) return "neg";
  return "neutral";
}

export function NewsList({
  articles,
  tickerHrefPrefix,
  emptyTitle = "No news to show.",
  emptyDescription = "No articles were returned for this selection.",
}: {
  articles: NewsArticle[];
  /** When set, ticker chips link to the asset page. */
  tickerHrefPrefix?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (articles.length === 0) {
    return (
      <EmptyState
        icon={<Newspaper className="size-5" />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <ul className="divide-y divide-hairline">
      {articles.map((article) => {
        const tone = sentimentTone(article.sentimentScore);

        return (
          <li key={article.id} className="px-4 py-3.5">
            <article className="flex gap-3.5">
              {article.bannerImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={article.bannerImage}
                  alt=""
                  width={96}
                  height={64}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="hidden h-16 w-24 shrink-0 rounded-md border border-hairline object-cover sm:block"
                />
              ) : null}

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group min-w-0"
                  >
                    <h3 className="text-[14px] font-medium leading-snug text-ink group-hover:underline">
                      {article.title}
                    </h3>
                  </a>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open "${article.title}" on the publisher's site`}
                    className="mt-0.5 shrink-0 text-ink-tertiary transition-colors hover:text-ink"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>

                {article.summary ? (
                  <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-ink-subtle">
                    {article.summary}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] text-ink-tertiary">
                  <span className="text-ink-muted">{article.source}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={article.publishedAt}>
                    {formatRelative(article.publishedAt)}
                  </time>

                  <span
                    className={cn(
                      "num rounded-[4px] border px-1.5 py-[1px]",
                      tone === "pos"
                        ? "border-pos/35 bg-pos/12 text-pos"
                        : tone === "neg"
                          ? "border-neg/35 bg-neg/12 text-neg"
                          : "border-hairline bg-surface-2 text-ink-subtle",
                    )}
                    title={`The news source labelled this article: ${article.sentimentLabel}`}
                  >
                    {article.sentimentLabel}{" "}
                    {article.sentimentScore >= 0 ? "+" : ""}
                    {article.sentimentScore.toFixed(2)}
                  </span>

                  {article.focusTicker && article.focusRelevance !== null ? (
                    <span
                      className="num"
                      title="How closely this article matches the ticker, according to the news source"
                    >
                      match {article.focusRelevance.toFixed(2)}
                    </span>
                  ) : null}

                  {article.tickers.slice(0, 4).map((ticker) =>
                    tickerHrefPrefix ? (
                      <Link
                        key={ticker}
                        href={`${tickerHrefPrefix}/${encodeURIComponent(ticker)}`}
                        className="rounded-[4px] border border-hairline bg-surface-2 px-1.5 py-[1px] font-mono text-[10.5px] text-ink-muted transition-colors hover:text-ink"
                      >
                        {ticker}
                      </Link>
                    ) : (
                      <span
                        key={ticker}
                        className="rounded-[4px] border border-hairline bg-surface-2 px-1.5 py-[1px] font-mono text-[10.5px] text-ink-muted"
                      >
                        {ticker}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

/** A single compact row, used in sidebars where a full card would be too tall. */
export function NewsHeadlineRow({ article }: { article: NewsArticle }) {
  return (
    <li>
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block px-4 py-2.5 transition-colors hover:bg-surface-2"
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
            {article.title}
          </span>
          <Badge tone={sentimentTone(article.sentimentScore)}>
            {article.sentimentScore >= 0 ? "+" : ""}
            {article.sentimentScore.toFixed(2)}
          </Badge>
        </span>
        <span className="mt-1 block text-[11px] text-ink-tertiary">
          {article.source} · {formatRelative(article.publishedAt)}
        </span>
      </a>
    </li>
  );
}
