import {
  Activity,
  ChartLine,
  GraduationCap,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import Link from "next/link";

import { getSessionContext } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/primitives";

export default async function HomePage() {
  const session = await getSessionContext();
  const destination =
    session?.profile.role === "teacher"
      ? "/teacher"
      : session?.profile.role === "student"
        ? "/student"
        : null;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-[6px] bg-brand text-[12px] font-semibold text-white"
          >
            P
          </span>
          <span className="text-[13px] font-medium tracking-tight text-ink">
            PaperDesk
          </span>
          <Badge tone="outline" className="ml-1 hidden sm:inline-flex">
            Virtual money only
          </Badge>

          <nav className="ml-auto flex items-center gap-2">
            {destination ? (
              <Button asChild size="md" variant="primary">
                <Link href={destination}>Go to dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="md" variant="ghost">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild size="md" variant="primary">
                  <Link href="/signup">Create a classroom</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <section className="py-16 sm:py-24">
          <p className="eyebrow">Classroom trading simulator</p>
          <h1 className="mt-4 max-w-3xl text-display font-medium text-ink sm:text-[52px] sm:leading-[1.08] sm:tracking-[-1.6px]">
            A market your class can actually run.
          </h1>
          <p className="mt-5 max-w-2xl text-subhead leading-relaxed text-ink-subtle">
            Students trade real US stocks and crypto against live market prices
            using virtual money. Teachers set the capital, the rules and the
            window — then watch every portfolio and every trade as it happens.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" variant="primary">
              <Link href="/signup">Create a classroom</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/login">I have an account</Link>
            </Button>
          </div>

          <p className="mt-4 text-[12px] text-ink-tertiary">
            No deposits, no brokerage connection, no real custody of funds.
          </p>
        </section>

        <section className="grid gap-4 pb-16 lg:grid-cols-3">
          <Panel className="p-5">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-ink-subtle" />
              <h2 className="text-[13px] font-medium text-ink">For teachers</h2>
            </div>
            <ul className="mt-4 space-y-2.5 text-[13px] leading-relaxed text-ink-subtle">
              {[
                "Provision student accounts and hand out credentials",
                "Set starting capital, per student or for the whole class",
                "Pause trading instantly, or schedule a trading window",
                "Restrict the class to an allow-list of assets",
                "Cap order size and concentration per position",
                "See every portfolio, trade and ranking in real time",
                "Reset one portfolio or the entire simulation",
                "Export results as CSV",
              ].map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-hairline-tertiary" />
                  {item}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center gap-2">
              <ChartLine className="size-4 text-ink-subtle" />
              <h2 className="text-[13px] font-medium text-ink">For students</h2>
            </div>
            <ul className="mt-4 space-y-2.5 text-[13px] leading-relaxed text-ink-subtle">
              {[
                "Search live US stocks and major crypto pairs",
                "Buy and sell against the current market price",
                "Track cash, positions, cost basis and P/L",
                "Recorded performance history, not invented curves",
                "Watchlists for assets they are researching",
                "Class leaderboard ranked by real portfolio value",
              ].map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-hairline-tertiary" />
                  {item}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-ink-subtle" />
              <h2 className="text-[13px] font-medium text-ink">
                What this is not
              </h2>
            </div>
            <ul className="mt-4 space-y-2.5 text-[13px] leading-relaxed text-ink-subtle">
              {[
                "Not a brokerage — no real orders are ever placed",
                "Not real money — no deposits, withdrawals or custody",
                "Not a real crypto wallet — no keys, no chain writes",
                "Not financial advice or a forecasting tool",
              ].map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-hairline-tertiary" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-hairline pt-4 text-[12px] leading-relaxed text-ink-tertiary">
              Prices come from Finnhub at the moment of the request. When the
              provider is unavailable the app says so and refuses the trade
              rather than inventing a number.
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 border-t border-hairline py-12 sm:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Set up the class",
              body: "Create a classroom, paste a roster, and issue each student a handle and password. No student email addresses required.",
            },
            {
              icon: Activity,
              title: "Students trade",
              body: "Every order is validated on the server against live prices, the classroom rules and the student's actual cash and holdings.",
            },
            {
              icon: GraduationCap,
              title: "Review and rank",
              body: "Portfolio values, returns and trade history come straight from the database — the leaderboard is real, not decorative.",
            },
          ].map((step) => (
            <div key={step.title}>
              <step.icon className="size-4 text-ink-tertiary" />
              <h3 className="mt-3 text-[13px] font-medium text-ink">
                {step.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-subtle">
                {step.body}
              </p>
            </div>
          ))}
        </section>

        <section className="border-t border-hairline py-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-title font-medium text-ink">
                Ready to run a simulation?
              </h2>
              <p className="mt-1.5 text-[13px] text-ink-subtle">
                Setting up a classroom takes about a minute.
              </p>
            </div>
            <Button asChild size="lg" variant="primary">
              <Link href="/signup">Create a classroom</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline py-8">
        <div className="mx-auto max-w-6xl px-4 text-[12px] text-ink-tertiary">
          PaperDesk · A classroom stock and cryptocurrency simulator using virtual
          money. Market data by Finnhub.
        </div>
      </footer>
    </div>
  );
}
