# PaperDesk — classroom trading simulator

A stock and cryptocurrency trading simulator for a classroom, using **virtual
money only**. Teachers create a classroom, issue student accounts, set the rules
and watch every portfolio; students trade real US stocks and crypto against live
market prices.

There is no brokerage connection, no deposits, no withdrawals, no wallets and no
custody of real funds anywhere in this codebase.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in the values:

| Variable                             | Where it comes from                       |
| ------------------------------------ | ----------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`           | Supabase → Project Settings → API         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API keys  |
| `SUPABASE_SECRET_KEY`                | Supabase → Project Settings → API keys (secret) |
| `FINNHUB_API_KEY`                    | https://finnhub.io/register (free tier)   |
| `CRON_SECRET`                        | Generate one — see the comment in `.env.example` |
| `STUDENT_EMAIL_DOMAIN`               | Any domain; students never receive email  |

The two `NEXT_PUBLIC_` values are the only ones that reach the browser.
`SUPABASE_SECRET_KEY` and `FINNHUB_API_KEY` are read exclusively by server
modules — anything secret must never be prefixed with `NEXT_PUBLIC_`.

### 3. Create the database schema

**This step is required before the app will run.** The schema creates 17 tables,
row level security policies and the trading engine.

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/migrations/0001_init.sql`.
3. Run it. It is written to be safe to run again if it is interrupted.
4. Then paste `supabase/migrations/0002_fix_class_overview.sql` and run it. That
   file is already folded into `0001`, so this is only needed if you applied an
   earlier copy of `0001` — `npm run check:db` tells you which case you are in.

Then verify:

```bash
npm run check:db
```

That prints which tables and functions are present or missing, **and then calls
the read-only RPCs with a nil id to confirm they actually run**. A function can
exist and still be broken, so the check distinguishes "missing" from "present but
failing" and names the migration that fixes it. It should end with
`Schema looks complete.`

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000, choose **Create a classroom**, and sign up as a
teacher. You land in the dashboard with one classroom already created.

---

## Using it

**As a teacher**

1. **Students** → paste a roster, one student per line:
   ```
   Ada Lovelace
   Grace Hopper, grace
   Alan Turing, alan.turing, 1023847
   ```
   Handles are generated from names if you omit them. The generated passwords are
   shown **once** — copy or download the CSV before leaving the page.
2. **Controls** → set starting capital, pause trading, schedule a trading window,
   cap order size and concentration, and restrict the class to an allow-list of
   assets.
3. **Overview / Students / Activity / Leaderboard / Competitions** → monitor the
   simulation. Every figure is computed in SQL.
4. **Export CSV** downloads standings plus the full trade ledger.
5.**Refresh prices** samples current quotes and records one portfolio snapshot
per student, which is what the performance charts are drawn from.

> **Note on charts:** price and portfolio history are only sampled over time
> (free-tier providers expose no historical candles), so a brand-new class shows
> empty charts with an explanatory empty state. Nothing is back-filled or
> fabricated to make a chart look populated.

**As a student**

Sign in with the handle and password the teacher issued. Search the market, open
an asset, and buy or sell from the order ticket. Portfolio value, cost basis,
realised and unrealised P/L, holdings, trade history and the class leaderboard
are all computed from the database.

---

## Architecture

```
src/
  app/
    (public)            /  /login  /signup  /dashboard
    teacher/            overview, students, student detail, activity,
                        leaderboard, competitions, controls
    student/            portfolio, market, asset detail, holdings,
                        activity, watchlist, leaderboard
    api/
      market/search     authenticated, rate-limited asset search
      teacher/export    CSV export (teacher-authorised, server-side check)
      cron/sample       scheduled price sampling + snapshots
  components/
    shell/              app shell, sidebar, top bar, mobile nav, auth panel
    data/               metric tiles, charts, sparkline, tables
    market/             asset search, trade panel, watchlist
    teacher/            roster form, controls, student actions, competition form
    ui/                 button, field, overlays, primitives
  lib/
    actions/            server actions (all mutations)
    auth/               session, role guards, workspace context
    data/               read-only loaders
    market/             Finnhub client + the only market data service
    supabase/           admin, server, browser and proxy clients
    types.ts            domain types + mappers from RPC payloads
    validation.ts       Zod schemas for every input boundary
supabase/migrations/    the schema, RLS policies and trading engine
scripts/                db-test.mjs, check-db.mjs
```

### Where the truth lives

The database is authoritative. Portfolio value, cash, ownership, cost basis and
profit/loss are all computed in SQL (`get_portfolio`, `get_leaderboard`,
`_portfolio_numbers`), and every mutation runs through a `SECURITY DEFINER`
function. React renders numbers; it never decides them.

Money is `numeric` everywhere — `cash numeric(18,4)`, `price numeric(18,6)`,
`quantity numeric(24,8)` — and there is a test asserting that no floating point
column exists in the schema.

### The trading engine

`execute_trade()` in `supabase/migrations/0001_init.sql` performs the whole
operation atomically:

1. Validate side, quantity and price.
2. Lock the student's membership row (`SELECT … FOR UPDATE`), which serialises
   that student's concurrent orders.
3. Check membership, trading enabled, trading window, asset permission and the
   fractional-shares rule.
4. Apply order-size and concentration limits.
5. Honour the idempotency key, so a double submission cannot execute twice.
6. Verify cash (buy) or holdings (sell), then write cash, holdings, order and
   transaction as one unit.

The server action above it authenticates the caller and fetches the price; the
browser is never trusted for a price, a balance, a role or an ownership claim.

### Security posture

- RLS is enabled on every table. Clients have **no** insert/update/delete
  policies on any financial table — the only writer is the trading engine.
- Read RPCs are `SECURITY DEFINER` and granted **only** to `service_role`, so a
  student cannot call `get_portfolio()` with somebody else's id through
  PostgREST. Reads that clients do perform directly go through RLS.
- Every server action re-checks ownership (`isClassroomTeacher`,
  `isClassroomStudent`) before touching anything.
- Student accounts are provisioned server-side with the Auth Admin API and
  already-confirmed internal addresses; the credential a student holds is
  handle + password. A student ID alone is never sufficient to sign in.
- All input is parsed with Zod at the boundary, and re-validated in SQL.

---

## Market data

Finnhub is the only provider. Everything goes through `src/lib/market/service.ts`;
no component calls the API directly.

**Free-tier limitations, and how this app adapts to them rather than hiding
them:**

- `/quote` and `/search` work on the free plan. `/stock/candle` and
  `/crypto/candle` **do not** — historical candles are not available.
- Therefore there is no back-filled chart. `price_history` is filled by sampling
  `/quote` over time (at most one sample per asset per five minutes), and charts
  are drawn only from points that were genuinely observed. An asset with one
  sample renders one point, and says so.
- `/search` does not cover crypto at all. Crypto search is served from the
  Binance symbol list, filtered locally.
- Quotes are cached in `price_cache` with a 60-second TTL, which also throttles
  the provider, and the client applies a 50-requests-per-minute limiter.
- If the provider fails, the last cached price is served **flagged as stale** and
  trading is refused. A price is never invented.

To keep the charts filling in automatically, either press **Refresh prices** or
deploy the cron in `vercel.json` (every five minutes at
`/api/cron/sample`, authenticated with `CRON_SECRET`).

---

## Tests

```bash
npm run test:db      # 106 assertions against a real PostgreSQL (PGlite)
npm run test:e2e     # the full flow against your live Supabase project
npm run smoke        # every authenticated page renders (needs a running server)
npm run typecheck
npm run build
```

`npm run test:db` runs the **real migration** against a real PostgreSQL (PGlite
— Postgres compiled to WASM) with a Supabase-shaped `auth` schema stubbed in, then
drives the trading engine through the scenarios that matter:

- buys, weighted average cost, partial sells, realised P/L arithmetic
- insufficient cash, overselling, zero/negative/non-numeric quantities
- trading paused, trading window open/closed, order-size and concentration caps
- allow-lists and the fractional-shares rule
- idempotent replay of a duplicate submission
- stale-price handling (cost basis is used, and the portfolio is *flagged*)
- teacher controls: cash adjustment (which moves starting capital with it, so a
  bonus is never counted as performance), student reset, class reset
- leaderboard ordering, snapshots, competitions
- Row Level Security: a student cannot read or write another student's holdings,
  membership row, profile or balance, and a teacher cannot reach another
  teacher's classroom

It requires no credentials and no network access.

### Live end-to-end (`npm run test:e2e`)

`test:db` runs against a local Postgres with a stubbed `auth` schema, so it cannot
prove anything about the hosted project: the real `service_role` grants, the real
RLS policies as PostgREST enforces them, real user provisioning through the Auth
admin API, or real market prices.

`npm run test:e2e` covers exactly that gap. It needs the credentials already in
`.env.local`, and it walks the product end to end:

- a real Finnhub quote, written into the price cache the way the market service
  writes it
- a teacher account, a classroom, and two students provisioned through the Auth
  admin API with virtual capital
- BUY, SELL, weighted average cost, realised and unrealised P/L marked to market
- every rejection the engine claims to make (insufficient cash, overselling, bad
  quantities, paused trading, closed window, allow-list, fractional rule,
  per-order cap, concentration cap, non-member)
- idempotent replay, and that a rejected order writes nothing
- teacher controls: cash adjustment framed against starting capital, student and
  class reset, competitions, snapshots, audit log
- **RLS isolation with real signed-in sessions**: a student sees only their own
  membership, holdings, orders and ledger, cannot insert rows, cannot move their
  own balance, cannot escalate their own role, cannot read the audit log, and
  cannot call the privileged RPCs through PostgREST at all

Everything it creates is named `[e2e] ...` / `e2e.*` and is deleted at the end.
The only real data it touches is the AAPL/TSLA price cache, which it restores. Use
`npm run test:e2e -- --keep` to leave the fixtures in place for inspection.

### Page render smoke test (`npm run smoke`)

This exists because a whole class of bug got through everything else: `next build`,
`tsc`, `test:db` and `test:e2e` all passed while **every authenticated page
returned HTTP 500** — a Radix tooltip in the top bar had no `TooltipProvider`
above it. An unauthenticated request never reaches the app shell (the proxy
redirects first), so checking that `/teacher` answers proves nothing about the
page behind it.

`npm run smoke` signs in for real, builds the same `@supabase/ssr` session cookie
a browser would hold, and requests all twelve authenticated routes, asserting each
one renders and contains text it could only have got from the database. Override
the target or the account with `--base=`, `SMOKE_TEACHER_EMAIL`,
`SMOKE_STUDENT_EMAIL` and friends.

---## No demo data

This application ships with **zero demo, seed or sample financial data**. A fresh
install has no students, no holdings, no orders, no transactions and no portfolios.
Every balance on screen traces back to an action a teacher or student actually
took in the database, and every price to the market data provider.

New students start with **$0** unless the teacher explicitly assigns capital —
per student in the roster form, or as a class default in Controls. There is no
seed script to run and none is needed: create a classroom, add your roster, and
the simulation starts empty and honest.

---

## Continuous integration

`.github/workflows/ci.yml` has two jobs:

**`verify`** — always runs, needs no credentials, covers every push:
`npm ci` → `lint` → `typecheck` → `build` → `test:db`. The build is given
placeholder environment values on purpose: the app reads configuration at request
time, never at module load, so a build only needs the variables to be present.
Nothing is deployed from CI, and no artifact is uploaded, so the inlined
placeholders cannot escape — a real deployment must build with real values.

**`integration`** — runs the checks that need a live project: `check:db`
(which fails if the schema is missing *or* if a function exists but throws),
`test:e2e`, then a production build and the page-render `smoke` test against it.

It is **off by default.** To enable it:

1. Set the repository variable `CI_INTEGRATION` to `true`
   (Settings → Secrets and variables → Actions → Variables).
2. Add these repository secrets: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `FINNHUB_API_KEY`, `CRON_SECRET`.

Until it is enabled the job is skipped rather than failed, so a fresh clone or a
fork stays green. **Point it at a dedicated project** — it creates and deletes
its own test accounts, so it must never be aimed at a project holding real class
data. Everything the e2e suite creates is named `[e2e] ...` and deleted at the
end.

Node version: CI pins 24, matching local development. Change both together.

---

## Deployment

1. Push to a Git repository and import it on Vercel.
2. Set the same environment variables in the Vercel project.
3. Deploy. `vercel.json` registers the sampling cron automatically; Vercel sends
   `Authorization: Bearer $CRON_SECRET` to it.
4. Run the migration against your production Supabase project (Step 3 above) if
   you have not already.

### Known trade-offs

- **Teacher signup is gated by invite codes, not email verification.** Set
  `TEACHER_INVITE_CODES` (comma-separated) to require a code on the signup
  form; leave it unset for open signup during local development. Accounts are
  still created already-confirmed — no transactional email is needed. For
  stronger verification, additionally switch `signUpTeacherAction` to
  Supabase's standard `signUp` flow and enable email confirmation.
- **Being a "teacher" grants nothing but ownership of your own classrooms.**
  Authorisation is derived from `classrooms.teacher_id` and
  `class_members.student_id`, never from a role flag, so self-signing-up as a
  teacher cannot expose anybody else's data.
- **No short selling, options, margin or limit orders.** The engine executes
  immediate market buys and sells only. These are not stubbed or faked — they
  simply do not exist in this MVP.
- **Price history starts empty.** That is a consequence of the provider's free
  tier, not a placeholder.
