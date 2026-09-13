/**
 * Database test harness.
 *
 * Runs the real migration against a real PostgreSQL (PGlite — Postgres compiled
 * to WASM), with a minimal Supabase-shaped `auth` schema stubbed in, then drives
 * the trading engine through the scenarios that matter. This catches SQL and
 * plpgsql errors and proves the money maths without needing the hosted database
 * or any credentials.
 *
 *   npm run test:db
 */
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

// ---------------------------------------------------------------------------
// Tiny assertion helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  \u001b[32mPASS\u001b[0m ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \u001b[31mFAIL\u001b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(
    name,
    String(actual) === String(expected),
    `expected ${expected}, got ${actual}`,
  );
}

function section(title) {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

// ---------------------------------------------------------------------------
// Supabase-shaped environment stub
// ---------------------------------------------------------------------------
const AUTH_STUB = `
create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to service_role;
`;

// Supabase grants table privileges to anon/authenticated by default. PGlite has
// no such defaults, so mirror them here — the point being that in these tests
// RLS, not a missing GRANT, is the only thing standing between a student and
// somebody else's data.
const GRANT_STUB = `
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
`;

const MIGRATION_PATHS = [
  "../supabase/migrations/0001_init.sql",
  "../supabase/migrations/0004_fund_requests.sql",
  "../supabase/migrations/0005_order_lifecycle.sql",
];

function loadMigration(path) {
  let sql = readFileSync(new URL(path, import.meta.url), "utf8");
  // PGlite does not ship the pgcrypto extension, and nothing in the schema
  // needs it on PostgreSQL 13+ (gen_random_uuid() is built in).
  sql = sql.replace(
    /create extension if not exists pgcrypto;/i,
    "-- [test harness] pgcrypto skipped; gen_random_uuid() is built in",
  );
  return sql;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TEACHER = "11111111-1111-1111-1111-111111111111";
const STUDENT_A = "22222222-2222-2222-2222-222222222222";
const STUDENT_B = "33333333-3333-3333-3333-333333333333";

async function seed(db) {
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${TEACHER}',   'teacher@school.edu', '{"role":"teacher","full_name":"Ms. Rivera"}'::jsonb),
      ('${STUDENT_A}', 'a@students.local',   '{"role":"student","full_name":"Ada Lovelace","login_handle":"ada"}'::jsonb),
      ('${STUDENT_B}', 'b@students.local',   '{"role":"student","full_name":"Grace Hopper","login_handle":"grace"}'::jsonb);

    insert into public.classrooms (id, teacher_id, name, section, join_code)
    values ('44444444-4444-4444-4444-444444444444', '${TEACHER}',
            'Economics Period 3', 'P3', 'ABC123');

    insert into public.class_members (classroom_id, student_id, display_name, initial_capital, cash_balance)
    values
      ('44444444-4444-4444-4444-444444444444', '${STUDENT_A}', 'Ada',   10000, 10000),
      ('44444444-4444-4444-4444-444444444444', '${STUDENT_B}', 'Grace', 10000, 10000);

    insert into public.price_cache (symbol, price, previous_close, change, change_percent, fetched_at)
    values
      ('AAPL', 100.000000, 98.000000, 2.000000, 2.040816, now()),
      ('BINANCE:BTCUSDT', 50000.000000, 49000.000000, 1000, 2.040816, now());
  `);
}

async function trade(db, { student = STUDENT_A, symbol = "AAPL", side = "buy", qty = "1", price = "100", key = null }) {
  const res = await db.query(
    `select public.execute_trade(
       '44444444-4444-4444-4444-444444444444'::uuid,
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text
     ) as r`,
    [student, symbol, side, qty, price, key],
  );
  return res.rows[0].r;
}

async function portfolio(db, student = STUDENT_A) {
  const res = await db.query(
    `select public.get_portfolio(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid
     ) as r`,
    [student],
  );
  return res.rows[0].r;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const db = new PGlite();
await db.waitReady;

section("Applying migrations");
try {
  await db.exec(AUTH_STUB);
  for (const path of MIGRATION_PATHS) {
    await db.exec(loadMigration(path));
  }
  await db.exec(GRANT_STUB);
  console.log("  \u001b[32mPASS\u001b[0m migrations applied cleanly");
  passed += 1;
} catch (error) {
  console.log(`  \u001b[31mFAIL\u001b[0m migration failed:\n${error.message}`);
  process.exit(1);
}

await seed(db);

try {

section("Schema shape");
{
  const { rows } = await db.query(
    `select count(*)::int as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  check("creates the expected number of tables", rows[0].n >= 17, `got ${rows[0].n}`);

  const t = await db.query(
    `select column_name, data_type from information_schema.columns
     where table_schema='public' and table_name='holdings' and column_name in ('quantity','avg_cost')`,
  );
  check(
    "money/quantity columns are numeric, never floating point",
    t.rows.every((r) => r.data_type === "numeric"),
    JSON.stringify(t.rows),
  );

  const settings = await db.query(
    `select trading_enabled from public.class_settings where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  eq("classroom trigger created a settings row", settings.rows.length, 1);
}

section("BUY");
{
  const r = await trade(db, { side: "buy", qty: "10", price: "100" });
  eq("buy succeeds", r.ok, true);
  eq("returns filled quantity", r.quantity, "10.00000000");
  eq("returns trade value", r.total_value, "1000.0000");
  eq("cash reduced correctly", r.portfolio.cash_balance, "9000.0000");
  eq("holdings market value", r.portfolio.holdings_market_value, "1000.0000");
  eq("total portfolio value", r.portfolio.total_value, "10000.0000");
  eq("average cost recorded", r.portfolio.holdings[0].avg_cost, "100.000000");
  eq("trade counted", r.portfolio.trade_count, 1);
  eq("P/L is zero at cost", r.portfolio.total_pnl, "0.0000");
}

section("BUY again — weighted average cost");
{
  const r = await trade(db, { side: "buy", qty: "10", price: "120" });
  eq("second buy succeeds", r.ok, true);
  eq("cash", r.portfolio.cash_balance, "7800.0000");
  eq("quantity accumulated", r.portfolio.holdings[0].quantity, "20.00000000");
  eq("weighted average cost", r.portfolio.holdings[0].avg_cost, "110.000000");
  eq("unrealised P/L at market 100", r.portfolio.unrealized_pnl, "-200.0000");
}

section("Rejections");
{
  const poor = await trade(db, { side: "buy", qty: "999999", price: "100" });
  eq("insufficient cash rejected", poor.ok, false);
  eq("insufficient cash code", poor.code, "INSUFFICIENT_CASH");

  const over = await trade(db, { side: "sell", qty: "999", price: "100" });
  eq("oversell rejected", over.ok, false);
  eq("oversell code", over.code, "INSUFFICIENT_HOLDINGS");

  const negative = await trade(db, { side: "buy", qty: "-5", price: "100" });
  eq("negative quantity rejected", negative.ok, false);
  eq("negative quantity code", negative.code, "INVALID_QUANTITY");

  const zero = await trade(db, { side: "buy", qty: "0", price: "100" });
  eq("zero quantity rejected", zero.ok, false);

  const nan = await trade(db, { side: "buy", qty: "ten", price: "100" });
  eq("non-numeric quantity rejected", nan.ok, false);
  eq("non-numeric quantity code", nan.code, "INVALID_QUANTITY");

  const badSide = await trade(db, { side: "short", qty: "1", price: "100" });
  eq("invalid side rejected", badSide.ok, false);
  eq("invalid side code", badSide.code, "INVALID_SIDE");

  const zeroPrice = await trade(db, { side: "buy", qty: "1", price: "0" });
  eq("non-positive price rejected", zeroPrice.ok, false);
  eq("non-positive price code", zeroPrice.code, "INVALID_PRICE");

  const badSymbol = await trade(db, { symbol: "NOTREAL", side: "buy", qty: "1", price: "100" });
  eq("unknown asset rejected", badSymbol.ok, false);
  eq("unknown asset code", badSymbol.code, "UNKNOWN_ASSET");

  const stranger = await db.query(
    `select public.execute_trade(
       '44444444-4444-4444-4444-444444444444'::uuid,
       gen_random_uuid(), 'AAPL', 'buy', '1', '100', null
     ) as r`,
  );
  eq("non-member rejected", stranger.rows[0].r.ok, false);
  eq("non-member code", stranger.rows[0].r.code, "NOT_A_MEMBER");

  const p = await portfolio(db);
  eq("rejected orders left state untouched", p.cash_balance, "7800.0000");
  eq("no phantom transactions", p.trade_count, 2);
}

section("SELL and realised P/L");
{
  const r = await trade(db, { side: "sell", qty: "5", price: "130" });
  eq("sell succeeds", r.ok, true);
  eq("realised P/L on the fill", r.realized_pnl, "100.0000");
  eq("cash credited", r.portfolio.cash_balance, "8450.0000");
  eq("quantity reduced", r.portfolio.holdings[0].quantity, "15.00000000");
  eq("average cost held on sell", r.portfolio.holdings[0].avg_cost, "110.000000");
  eq("realised P/L accumulated", r.portfolio.realized_pnl, "100.0000");
}

section("Idempotency");
{
  const key = "a5a5a5a5-0000-4000-8000-000000000001";
  const first = await trade(db, { side: "buy", qty: "1", price: "100", key });
  eq("first submission fills", first.duplicate, false);
  const before = (await portfolio(db)).cash_balance;

  const second = await trade(db, { side: "buy", qty: "1", price: "100", key });
  eq("replay detected", second.duplicate, true);
  const after = await portfolio(db);
  eq("replay did not move cash", after.cash_balance, before);
  eq("replay did not add a second transaction", after.trade_count, 4);
}

section("Trading controls");
{
  await db.exec(
    `update public.class_settings set trading_enabled = false,
      paused_reason = 'Quiz in progress' where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const paused = await trade(db, { side: "buy", qty: "1", price: "100" });
  eq("paused classroom blocks trading", paused.ok, false);
  eq("paused code", paused.code, "TRADING_PAUSED");
  check(
    "paused message comes from the teacher's reason",
    String(paused.message).includes("Quiz in progress"),
    paused.message,
  );

  await db.exec(
    `update public.class_settings set trading_enabled = true, paused_reason = null
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );

  await db.exec(
    `update public.class_settings set trading_opens_at = now() + interval '1 hour'
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const early = await trade(db, { side: "buy", qty: "1", price: "100" });
  eq("trading window not yet open", early.code, "MARKET_CLOSED");

  await db.exec(
    `update public.class_settings set trading_opens_at = null, trading_closes_at = now() - interval '1 hour'
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const late = await trade(db, { side: "buy", qty: "1", price: "100" });
  eq("trading window closed", late.code, "MARKET_CLOSED");

  await db.exec(
    `update public.class_settings set trading_closes_at = null where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );

  await db.exec(
    `update public.class_settings set max_trade_value = 500
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const tooBig = await trade(db, { side: "buy", qty: "10", price: "100" });
  eq("per-order value cap enforced", tooBig.code, "TRADE_TOO_LARGE");
  await db.exec(
    `update public.class_settings set max_trade_value = null where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
}

section("Allow-list policy");
{
  await db.exec(
    `update public.class_settings set asset_policy = 'allowlist'
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const blocked = await trade(db, { symbol: "AAPL", side: "buy", qty: "1", price: "100" });
  eq("unlisted asset blocked", blocked.code, "ASSET_NOT_PERMITTED");

  await db.exec(
    `insert into public.classroom_assets (classroom_id, asset_id)
     select '44444444-4444-4444-4444-444444444444', id from public.assets where symbol = 'AAPL'`,
  );
  const allowed = await trade(db, { symbol: "AAPL", side: "buy", qty: "1", price: "100" });
  eq("allow-listed asset permitted", allowed.ok, true);

  await db.exec(
    `update public.class_settings set asset_policy = 'all'
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
}

section("Fractional shares policy");
{
  await db.exec(
    `update public.class_settings set allow_fractional = false
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const frac = await trade(db, { symbol: "AAPL", side: "buy", qty: "0.5", price: "100" });
  eq("fractional stock blocked when disabled", frac.code, "FRACTIONAL_DISABLED");

  const whole = await trade(db, { symbol: "AAPL", side: "buy", qty: "2", price: "100" });
  eq("whole shares still allowed", whole.ok, true);

  await db.exec(
    `update public.class_settings set allow_fractional = true
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const crypto = await trade(db, { symbol: "BINANCE:BTCUSDT", side: "buy", qty: "0.01", price: "50000" });
  eq("fractional crypto allowed", crypto.ok, true);
  eq("crypto quantity stored with 8dp", crypto.portfolio.holdings.find((h) => h.symbol === "BINANCE:BTCUSDT").quantity, "0.01000000");
}

section("Portfolio maths with a stale price");
{
  await db.exec(`delete from public.price_cache where symbol = 'AAPL'`);
  const p = await portfolio(db);
  const aapl = p.holdings.find((h) => h.symbol === "AAPL");
  eq("cost basis is used when no price is cached", aapl.last_price, aapl.avg_cost);
  eq("an unpriced holding contributes no fake gain", aapl.unrealized_pnl, "0.0000");
  eq("stale price flag raised", p.holdings.find((h) => h.symbol === "AAPL").price_stale, true);
  eq("portfolio flagged incomplete", p.prices_incomplete, true);
  await db.exec(
    `insert into public.price_cache (symbol, price, fetched_at) values ('AAPL', 100, now())`,
  );
}

section("Leaderboard");
{
  const lb = await db.query(`select * from public.get_leaderboard('44444444-4444-4444-4444-444444444444')`);
  eq("both students ranked", lb.rows.length, 2);
  check(
    "ordered by total value descending",
    Number(lb.rows[0].total_value) >= Number(lb.rows[1].total_value),
    `${lb.rows[0].total_value} vs ${lb.rows[1].total_value}`,
  );
  // Grace never traded, so she sits at exactly her starting capital. Ada's
  // round-trip netted a loss once the stale-price fallback is applied, so the
  // ranking must put Grace first — a leaderboard that flatters the active
  // trader would be wrong.
  eq("the untraded portfolio leads", lb.rows[0].display_name, "Grace");
  eq("rank column populated", lb.rows[0].rank_position, 1);
  eq("rank 2 for the second student", lb.rows[1].rank_position, 2);
  eq("ranks are distinct", lb.rows[0].student_id === lb.rows[1].student_id, false);
  check(
    "return percentage is derived from initial capital",
    Number(lb.rows[0].total_pnl_percent) ===
      Number(((Number(lb.rows[0].total_pnl) / 10000) * 100).toFixed(4)),
    JSON.stringify(lb.rows[0]),
  );
}

// Regression: get_class_overview() reads the leaderboard internally, and used to
// reference a column name that does not exist on the RETURNS TABLE signature
// (`label` instead of `display_name`). Nothing exercised it, so the whole teacher
// overview broke silently. Call it and assert its leader/lagging fields.
section("Class overview");
{
  const res = await db.query(
    `select public.get_class_overview('44444444-4444-4444-4444-444444444444') as r`,
  );
  const o = res.rows[0].r;
  check("overview returns a payload", Boolean(o), JSON.stringify(o));
  eq("counts the active students", o.student_count, 2);
  eq("totals the starting capital", o.total_capital, "20000.0000");
  eq("names the leading student", o.leader, "Grace");
  eq("names the lagging student", o.lagging, "Ada");
  check(
    "recent trades are included",
    Array.isArray(o.recent_trades) && o.recent_trades.length > 0,
    JSON.stringify(o.recent_trades),
  );
}

section("Teacher controls");
{
  const before = await portfolio(db, STUDENT_B);
  const adj = await db.query(
    `select public.adjust_cash('44444444-4444-4444-4444-444444444444', $1::uuid, 2500, 'bonus', $2::uuid) as r`,
    [STUDENT_B, TEACHER],
  );
  eq("cash adjustment succeeds", adj.rows[0].r.ok, true);
  eq("cash added", adj.rows[0].r.portfolio.cash_balance, "12500.0000");
  eq("initial capital moved with it", adj.rows[0].r.portfolio.initial_capital, "12500.0000");
  eq("a bonus is not performance", adj.rows[0].r.portfolio.total_pnl, "0.0000");
  check("bonus increased total value", Number(adj.rows[0].r.portfolio.total_value) > Number(before.total_value));

  const negative = await db.query(
    `select public.adjust_cash('44444444-4444-4444-4444-444444444444', $1::uuid, -999999, 'oops', $2::uuid) as r`,
    [STUDENT_B, TEACHER],
  );
  eq("cannot push a balance below zero", negative.rows[0].r.ok, false);

  const zero = await db.query(
    `select public.adjust_cash('44444444-4444-4444-4444-444444444444', $1::uuid, 0, 'nothing', $2::uuid) as r`,
    [STUDENT_B, TEACHER],
  );
  eq("zero adjustment rejected", zero.rows[0].r.ok, false);

  const reset = await db.query(
    `select public.reset_student_portfolio('44444444-4444-4444-4444-444444444444', $1::uuid, 5000, $2::uuid) as r`,
    [STUDENT_A, TEACHER],
  );
  eq("student reset succeeds", reset.rows[0].r.ok, true);
  eq("cash restored to new capital", reset.rows[0].r.portfolio.cash_balance, "5000.0000");
  eq("holdings cleared", reset.rows[0].r.portfolio.holdings.length, 0);
  eq("transactions cleared", reset.rows[0].r.portfolio.trade_count, 0);
}

section("Snapshots and today's P/L");
{
  const p = await portfolio(db);
  check("a snapshot was captured by the reset", p.today_basis_kind !== "none", p.today_basis_kind);

  const count = await db.query(`select public.capture_snapshots() as n`);
  check("class-wide snapshot ran", count.rows[0].n >= 2, `got ${count.rows[0].n}`);

  const series = await db.query(
    `select count(*)::int as n from public.portfolio_snapshots where student_id = $1::uuid`,
    [STUDENT_A],
  );
  check("snapshots are recorded for the performance chart", series.rows[0].n >= 1, `got ${series.rows[0].n}`);

  const grace = await db.query(
    `select count(*)::int as n from public.portfolio_snapshots where student_id = $1::uuid`,
    [STUDENT_B],
  );
  check("the class-wide snapshot reached every member", grace.rows[0].n >= 1, `got ${grace.rows[0].n}`);
}

section("Competitions");
{
  const created = await db.query(
    `select public.create_competition(
       '44444444-4444-4444-4444-444444444444'::uuid, 'Week 1 Sprint', 'First week',
       now() - interval '1 day', now() + interval '6 days', $1::uuid
     ) as r`,
    [TEACHER],
  );
  eq("competition created", created.rows[0].r.ok, true);
  eq("all active students entered", created.rows[0].r.entries, 2);

  const bad = await db.query(
    `select public.create_competition(
       '44444444-4444-4444-4444-444444444444'::uuid, 'Backwards', null,
       now() + interval '1 day', now(), $1::uuid
     ) as r`,
    [TEACHER],
  );
  eq("inverted window rejected", bad.rows[0].r.ok, false);

  const standings = await db.query(
    `select * from public.get_competition_standings($1::uuid)`,
    [created.rows[0].r.competition_id],
  );
  eq("standings list every entrant", standings.rows.length, 2);
  check("standings carry an opening baseline", Number(standings.rows[0].opening_value) > 0);
}

section("Row Level Security");
{
  // Act as the teacher.
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${TEACHER}', false);`);
  const teacherSees = await db.query(`select count(*)::int as n from public.holdings`);
  check("teacher can read holdings in their own classroom", teacherSees.rows[0].n >= 0);

  const teacherClass = await db.query(`select count(*)::int as n from public.classrooms`);
  eq("teacher sees their classroom", teacherClass.rows[0].n, 1);

  const teacherName = await db.query(`select full_name from public.profiles where id = $1::uuid`, [STUDENT_A]);
  eq("teacher can read a student's profile", teacherName.rows[0]?.full_name, "Ada Lovelace");

  // Act as a student.
  await db.exec(`select set_config('request.jwt.claim.sub', '${STUDENT_B}', false);`);
  const ownHoldings = await db.query(
    `select count(*)::int as n from public.holdings where student_id = '${STUDENT_A}'`,
  );
  eq("a student cannot read another student's holdings", ownHoldings.rows[0].n, 0);

  const ownMembers = await db.query(
    `select count(*)::int as n from public.class_members where student_id = '${STUDENT_A}'`,
  );
  eq("a student cannot read another student's membership row", ownMembers.rows[0].n, 0);

  const theirProfile = await db.query(`select count(*)::int as n from public.profiles where id = '${STUDENT_A}'`);
  eq("a student cannot read another student's profile", theirProfile.rows[0].n, 0);

  // RLS filters silently on UPDATE rather than raising, so assert on the value.
  await db
    .query(`update public.class_members set cash_balance = 999999 where student_id = '${STUDENT_B}'`)
    .catch(() => undefined);
  await db.exec(`reset role;`);
  const afterAttempt = await db.query(
    `select cash_balance from public.class_members where student_id = '${STUDENT_B}'`,
  );
  check(
    "a student cannot credit their own balance",
    Number(afterAttempt.rows[0].cash_balance) !== 999999,
    `balance is ${afterAttempt.rows[0].cash_balance}`,
  );
  await db.exec(`select set_config('request.jwt.claim.sub', '${STUDENT_B}', false); set role authenticated;`);

  const holdingsWrite = await db
    .query(`insert into public.holdings (classroom_id, student_id, asset_id, quantity, avg_cost)
            select '44444444-4444-4444-4444-444444444444', '${STUDENT_B}', id, 99999, 1 from public.assets limit 1`)
    .then(() => "inserted")
    .catch(() => "denied");
  eq("a student cannot fabricate a holding", holdingsWrite, "denied");

  // A teacher must not reach a classroom they do not own.
  await db.exec(`
    reset role;
    insert into auth.users (id, email, raw_user_meta_data) values
      ('55555555-5555-5555-5555-555555555555', 'other@school.edu', '{"role":"teacher","full_name":"Mr. Other"}'::jsonb);
    insert into public.classrooms (id, teacher_id, name, join_code)
    values ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'Other Class', 'ZZZ999');
    select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
    set role authenticated;
  `);
  const otherTeacher = await db.query(
    `select count(*)::int as n from public.holdings where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  eq("a teacher cannot read another teacher's classroom", otherTeacher.rows[0].n, 0);

  await db.exec(`reset role;`);
}

section("Order lifecycle — limit, stop, stop-limit");
{
  const placed = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'limit', '5', '95', null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  eq("limit order accepted", placed.rows[0].r.ok, true);
  eq("limit order rests pending", placed.rows[0].r.status, "pending");

  const cashBefore = Number((await portfolio(db, STUDENT_A)).cash_balance);
  check("buy reserve takes a lien on cash", cashBefore < 9450, `cash is ${cashBefore}`);

  // Price above the limit: must NOT fill.
  const noFill = await db.query(
    `select public.fill_order($1::uuid, '96') as r`, [placed.rows[0].r.order_id],
  );
  eq("limit buy does not fill above its limit", noFill.rows[0].r.no_action, true);

  // Price reaches the limit: fills AT the limit price, not the market price.
  const fill = await db.query(
    `select public.fill_order($1::uuid, '94') as r`, [placed.rows[0].r.order_id],
  );
  eq("limit buy fills when price reaches limit", fill.rows[0].r.status, "filled");
  eq("limit buy fills at the limit price", fill.rows[0].r.execution_price, "95.000000");

  const afterLimit = await portfolio(db, STUDENT_A);
  // The teacher-controls section reset Ada's history, so the limit fill is the
  // only transaction on the book right now.
  check("a limit fill created a transaction", afterLimit.trade_count >= 1, `trade_count ${afterLimit.trade_count}`);

  const execCount = await db.query(
    `select count(*)::int as n from public.executions e join public.orders o on o.id = e.order_id
     where o.student_id = $1::uuid`, [STUDENT_A],
  );
  check("executions ledger recorded the fill", execCount.rows[0].n >= 1, `got ${execCount.rows[0].n}`);

  // Stop order: sell stop triggers only when price falls to the stop.
  const stopOrder = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'sell', 'stop', '2', null, '90', null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  eq("stop sell accepted", stopOrder.rows[0].r.ok, true);

  const tooHigh = await db.query(
    `select public.fill_order($1::uuid, '95') as r`, [stopOrder.rows[0].r.order_id],
  );
  eq("stop sell does not trigger above its stop", tooHigh.rows[0].r.no_action, true);

  const triggered = await db.query(
    `select public.fill_order($1::uuid, '89') as r`, [stopOrder.rows[0].r.order_id],
  );
  eq("stop sell triggers at the stop", triggered.rows[0].r.status, "filled");
  eq("stop fills at the market price", triggered.rows[0].r.execution_price, "89.000000");

  // Stop-limit sell: activates at the stop, only fills within the limit band.
  const stopLimit = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'sell', 'stop_limit', '1', '92', '90', null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  eq("stop-limit sell accepted", stopLimit.rows[0].r.ok, true);

  const outsideBand = await db.query(
    `select public.fill_order($1::uuid, '85') as r`, [stopLimit.rows[0].r.order_id],
  );
  eq("stop-limit sell will not fill below its limit", outsideBand.rows[0].r.no_action, true);

  const cancelled = await db.query(
    `select public.cancel_order($1::uuid, $2::uuid) as r`,
    [stopLimit.rows[0].r.order_id, STUDENT_A],
  );
  eq("student cancels their own order", cancelled.rows[0].r.ok, true);

  const foreignCancel = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'limit', '1', '90', null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  const steal = await db.query(
    `select public.cancel_order($1::uuid, $2::uuid) as r`,
    [foreignCancel.rows[0].r.order_id, STUDENT_B],
  );
  eq("one student cannot cancel another's order", steal.rows[0].r.ok, false);
  eq("foreign cancel code", steal.rows[0].r.code, "FORBIDDEN");
  await db.query(`select public.cancel_order($1::uuid, $2::uuid)`, [foreignCancel.rows[0].r.order_id, STUDENT_A]);
}

section("Buying power + market-hours controls");
{
  // Drain Ada's cash to a known state first.
  await db.query(
    `select public.reset_student_portfolio('44444444-4444-4444-4444-444444444444', $1::uuid, 1000, null) as r`,
    [STUDENT_A],
  );

  const big = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'limit', '20', '100', null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  eq("buy beyond buying power rejected", big.rows[0].r.ok, false);
  eq("buying power code", big.rows[0].r.code, "INSUFFICIENT_BUYING_POWER");

  const affordable = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'limit', '5', '100', null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  eq("affordable order accepted", affordable.rows[0].r.ok, true);

  const second = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'limit', '6', '100', null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  eq("overlapping orders cannot double-commit the same cash", second.rows[0].r.ok, false);

  // Market-hours enforcement: equity orders rejected outside regular hours.
  const closed = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'market', '1', null, null, null, 'closed'
     ) as r`,
    [STUDENT_A],
  );
  eq("equity order rejected while market closed", closed.rows[0].r.ok, false);
  eq("market-closed code", closed.rows[0].r.code, "MARKET_CLOSED");

  // Crypto is exempt from equity hours (spec §12).
  const crypto247 = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'BINANCE:BTCUSDT', 'buy', 'market', '0.001', null, null, null, 'closed'
     ) as r`,
    [STUDENT_A],
  );
  eq("crypto trades while equities are closed", crypto247.rows[0].r.ok, true);
  await db.query(`select public.cancel_order($1::uuid, $2::uuid)`, [crypto247.rows[0].r.order_id, STUDENT_A]);
  await db.query(`select public.cancel_order($1::uuid, $2::uuid)`, [affordable.rows[0].r.order_id, STUDENT_A]);

  // Order-type permissions.
  await db.exec(
    `update public.class_settings set allowed_order_types = '{market}'
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const disabled = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'limit', '1', '90', null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  eq("disabled order type rejected", disabled.rows[0].r.code, "ORDER_TYPE_DISABLED");
  await db.exec(
    `update public.class_settings set allowed_order_types = '{market,limit,stop,stop_limit}'
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );

  // Crypto kill-switch.
  await db.exec(
    `update public.class_settings set crypto_enabled = false
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const noCrypto = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'BINANCE:BTCUSDT', 'buy', 'market', '0.001', null, null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  eq("crypto disabled by teacher", noCrypto.rows[0].r.code, "CRYPTO_DISABLED");
  await db.exec(
    `update public.class_settings set crypto_enabled = true
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );

  // Emergency halt leaves working orders unfilled.
  const resting = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'limit', '1', '1000', null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  await db.exec(
    `update public.class_settings set trading_enabled = false
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  const halted = await db.query(
    `select public.fill_order($1::uuid, '10') as r`, [resting.rows[0].r.order_id],
  );
  eq("emergency halt fills nothing", halted.rows[0].r.halted, true);
  eq("order survives a halt as pending", halted.rows[0].r.status, "pending");
  await db.exec(
    `update public.class_settings set trading_enabled = true
     where classroom_id = '44444444-4444-4444-4444-444444444444'`,
  );
  await db.query(`select public.cancel_order($1::uuid, $2::uuid)`, [resting.rows[0].r.order_id, STUDENT_A]);

  // Expiry.
  const expiring = await db.query(
    `select public.place_order(
       '44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 'AAPL', 'buy', 'limit', '1', '50', null, null, 'regular'
     ) as r`,
    [STUDENT_A],
  );
  await db.exec(
    `update public.orders set expires_at = now() - interval '1 minute' where id = '${expiring.rows[0].r.order_id}'`,
  );
  const expired = await db.query(`select public.expire_stale_orders() as n`);
  check("stale orders expired", expired.rows[0].n >= 1, `got ${expired.rows[0].n}`);
  const expiredStatus = await db.query(
    `select status from public.orders where id = $1::uuid`, [expiring.rows[0].r.order_id],
  );
  eq("expired order status", expiredStatus.rows[0].status, "expired");
}

section("Teacher cash ledger");
{
  const grant = await db.query(
    `select public.grant_teacher_cash('44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 2500, 'class bank', $2::uuid) as r`,
    [STUDENT_B, TEACHER],
  );
  eq("teacher credit succeeds", grant.rows[0].r.ok, true);
  eq("credit event recorded", grant.rows[0].r.event, "teacher_credit");

  const debit = await db.query(
    `select public.grant_teacher_cash('44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, -100, 'fee', $2::uuid) as r`,
    [STUDENT_B, TEACHER],
  );
  eq("teacher debit succeeds", debit.rows[0].r.ok, true);
  eq("debit event recorded", debit.rows[0].r.event, "teacher_debit");

  const events = await db.query(
    `select event_type, amount from public.cash_events
     where student_id = $1::uuid order by created_at desc limit 2`,
    [STUDENT_B],
  );
  eq("ledger holds the credit", events.rows[1]?.event_type ?? events.rows[0].event_type, "teacher_credit");
  check(
    "amounts are positive on the ledger",
    events.rows.every((row) => Number(row.amount) > 0),
    JSON.stringify(events.rows),
  );
}

section("Return-percent leaderboard ranking");
{
  // Give the two students different capitals and check the ranking follows
  // percentage return, not absolute value (spec §8).
  await db.query(
    `select public.reset_student_portfolio('44444444-4444-4444-4444-444444444444', $1::uuid, 1000, null) as r`,
    [STUDENT_A],
  );
  await db.query(
    `select public.reset_student_portfolio('44444444-4444-4444-4444-444444444444', $1::uuid, 10000, null) as r`,
    [STUDENT_B],
  );

  // Ada: 1000 -> 1100 (+10%). Grace: 10000 -> 10400 (+4%).
  await trade(db, { student: STUDENT_A, symbol: "AAPL", side: "buy", qty: "1", price: "100" });
  await db.exec(`update public.price_cache set price = 200 where symbol = 'AAPL'`);
  await db.query(
    `select public.grant_teacher_cash('44444444-4444-4444-4444-444444444444'::uuid, $1::uuid, 400, 'gift', null) as r`,
    [STUDENT_B],
  );

  const lb = await db.query(`select * from public.get_leaderboard('44444444-4444-4444-4444-444444444444')`);
  eq("the higher PERCENT return ranks first", lb.rows[0].display_name, "Ada");
  check(
    "percentage ranking is independent of portfolio size",
    Number(lb.rows[0].total_value) < Number(lb.rows[1].total_value),
    `${lb.rows[0].total_value} vs ${lb.rows[1].total_value}`,
  );
  eq("rank 1 is Ada", lb.rows[0].rank_position, 1);
  eq("rank 2 is Grace", lb.rows[1].rank_position, 2);
}

section("No fabricated data");
{
  const floatCols = await db.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('double precision', 'real')
  `);
  eq("no floating point columns anywhere in the schema", floatCols.rows.length, 0);
}

} catch (error) {
  // Print only the database's own message — the driver's stack trace dumps the
  // whole minified WASM bundle and buries the actual error.
  failed += 1;
  failures.push(error.message);
  console.log(`\n  \u001b[31mUNCAUGHT\u001b[0m ${error.message}`);
  if (error.where) console.log(`  at ${error.where}`);
  if (error.hint) console.log(`  hint: ${error.hint}`);
}

// ---------------------------------------------------------------------------
console.log(
  `\n\u001b[1m${passed} passed, ${failed} failed\u001b[0m${
    failures.length ? `\n\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}` : ""
  }`,
);

await db.close();
process.exit(failed > 0 ? 1 : 0);
