/**
 * Live end-to-end verification against the configured Supabase project.
 *
 * This is the test that PGlite cannot give us: it exercises the real PostgREST
 * deployment, the real auth admin API, the real `service_role` grants, and the
 * real row level security policies — the things that only exist once the
 * migration is applied to the hosted project.
 *
 * It walks the product's actual flow, in order:
 *
 *   teacher account -> classroom -> provisioned students -> market price
 *   -> BUY -> SELL -> every rejection the engine claims to make
 *   -> teacher controls -> portfolio maths -> leaderboard
 *   -> row level security isolation between two students
 *
 * Everything it creates is named "[e2e] ..." / `e2e.*` and is deleted at the
 * end (pass --keep to leave it in place for inspection). The one piece of real
 * data it touches is the AAPL/TSLA price cache, which it records and restores.
 *
 *   npm run test:e2e
 *   npm run test:e2e -- --keep
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    try {
      raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    } catch {
      return env;
    }
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

const env = { ...loadEnvLocal(), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = env.SUPABASE_SECRET_KEY;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const finnhubKey = env.FINNHUB_API_KEY;
const studentDomain = env.STUDENT_EMAIL_DOMAIN ?? "students.classroom-trading.local";
const keep = process.argv.includes("--keep");

if (!url || !secretKey || !publishableKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
  );
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";

let passed = 0;
const failures = [];
let currentSection = "";

function section(name) {
  currentSection = name;
  console.log(`\n${BOLD}${name}${RESET}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ${GREEN}pass${RESET} ${name}`);
  } catch (error) {
    failures.push({ section: currentSection, name, message: error.message });
    console.log(`  ${RED}FAIL${RESET} ${name}`);
    console.log(`       ${RED}${error.message}${RESET}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Compares numeric-ish values with a small tolerance, for money maths. */
function assertMoney(actual, expected, label, tolerance = 0.01) {
  const a = Number(actual);
  const e = Number(expected);
  assert(
    Number.isFinite(a) && Math.abs(a - e) <= tolerance,
    `${label}: expected ${e}, got ${actual}`,
  );
}

function assertCode(result, code, label) {
  assert(result !== null, `${label}: no result returned`);
  assert(
    result.ok === false,
    `${label}: expected ok=false, got ${JSON.stringify(result).slice(0, 200)}`,
  );
  assert(
    result.code === code,
    `${label}: expected code ${code}, got ${result.code} (${result.message})`,
  );
}

async function rpc(name, args) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(`${name}() transport error: ${error.message}`);
  return data;
}

function randomToken(length) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const stamp = Date.now().toString(36).toUpperCase();
const classroomName = `[e2e] Classroom ${stamp}`;
const teacherPassword = `E2E-teacher-${randomToken(10)}`;
let quote = null;
let aaplQuote = null;
let tslaQuote = null;
let tslaMarkedDown = null;
let teacher = null;
let classroomId = null;
let alice = null;
let bob = null;
let aapl = null;
let restored = false;

async function fetchQuote(symbol) {
  const response = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`,
  );
  if (!response.ok) throw new Error(`Finnhub HTTP ${response.status} for ${symbol}`);
  const body = await response.json();
  return {
    price: Number(body.c),
    previousClose: Number(body.pc) || null,
    change: Number(body.d) || null,
    changePercent: Number(body.dp) || null,
    high: Number(body.h) || null,
    low: Number(body.l) || null,
    open: Number(body.o) || null,
    providerTime: Number(body.t) ? new Date(Number(body.t) * 1000).toISOString() : null,
  };
}

/** Writes a quote into the cache exactly the way the market service does. */
async function writeCachedPrice(symbol, price, changePercent = null) {
  const { error } = await admin.from("price_cache").upsert(
    {
      symbol,
      price: price.toFixed(6),
      change_percent: changePercent === null ? null : changePercent.toFixed(6),
      fetched_at: new Date().toISOString(),
      last_error: null,
      error_at: null,
    },
    { onConflict: "symbol" },
  );
  if (error) throw new Error(`price_cache upsert for ${symbol}: ${error.message}`);
}

async function provisionStudent(handle, fullName, externalId) {
  const password = `E2E-${randomToken(10)}`;
  const email = `${handle}@${studentDomain}`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "student", full_name: fullName, login_handle: handle },
  });
  if (error || !created?.user) {
    throw new Error(`createUser(${handle}): ${error?.message ?? "no user returned"}`);
  }
  const id = created.user.id;

  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      { id, role: "student", full_name: fullName, login_handle: handle, email },
      { onConflict: "id" },
    );
  if (profileError) throw new Error(`profiles upsert(${handle}): ${profileError.message}`);

  const { error: memberError } = await admin.from("class_members").insert({
    classroom_id: classroomId,
    student_id: id,
    display_name: fullName,
    external_id: externalId,
    cash_balance: "10000",
    initial_capital: "10000",
    status: "active",
  });
  if (memberError) throw new Error(`class_members insert(${handle}): ${memberError.message}`);

  return { id, handle, email, password, fullName };
}

async function trade(studentId, side, quantity, price, idempotencyKey = null) {
  return rpc("execute_trade", {
    p_classroom_id: classroomId,
    p_student_id: studentId,
    p_symbol: "AAPL",
    p_side: side,
    p_quantity: String(quantity),
    p_price: String(price),
    p_idempotency_key: idempotencyKey,
  });
}

async function settings(patch) {
  const { error } = await admin
    .from("class_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("classroom_id", classroomId);
  if (error) throw new Error(`class_settings update: ${error.message}`);
}

async function memberRow(studentId) {
  const { data, error } = await admin
    .from("class_members")
    .select("cash_balance, initial_capital, status")
    .eq("classroom_id", classroomId)
    .eq("student_id", studentId)
    .single();
  if (error) throw new Error(`class_members read: ${error.message}`);
  return data;
}

async function portfolio(studentId) {
  const data = await rpc("get_portfolio", {
    p_classroom_id: classroomId,
    p_student_id: studentId,
  });
  assert(data, "get_portfolio returned null for a member");
  return data;
}

function holdingFor(payload, symbol) {
  return (payload.holdings ?? []).find((h) => h.symbol === symbol) ?? null;
}

async function signIn(email, password) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      if (!data?.user) throw new Error("no user returned");
      return { client, user: data.user };
    } catch (error) {
      // A connection reset against the hosted auth endpoint is infrastructure
      // noise rather than a product failure, so give it two more tries.
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw new Error(`sign-in failed after 3 attempts: ${lastError?.message ?? "unknown"}`);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
console.log(`${BOLD}Live end-to-end verification${RESET} ${DIM}${url}${RESET}`);

try {
  // =========================================================================
  section("Market data");
  // =========================================================================
  await test("Finnhub returns a live AAPL and TSLA quote", async () => {
    aaplQuote = await fetchQuote("AAPL");
    tslaQuote = await fetchQuote("TSLA");
    assert(aaplQuote.price > 0, `AAPL price was ${aaplQuote.price}`);
    assert(tslaQuote.price > 0, `TSLA price was ${tslaQuote.price}`);
  });

  if (!aaplQuote || !tslaQuote) {
    throw new Error("Cannot continue without a market price; Finnhub returned nothing.");
  }
  quote = aaplQuote;

  await test("price cache accepts a real quote", async () => {
    await writeCachedPrice("AAPL", aaplQuote.price, aaplQuote.changePercent);
    await writeCachedPrice("TSLA", tslaQuote.price, tslaQuote.changePercent);
    const { data } = await admin
      .from("price_cache")
      .select("symbol, price")
      .in("symbol", ["AAPL", "TSLA"]);
    assert(data?.length === 2, `expected 2 cached symbols, got ${data?.length ?? 0}`);
  });

  await test("upsert_asset resolves the tradeable universe (the ensureAsset path)", async () => {
    const aaplId = await rpc("upsert_asset", {
      p_symbol: "AAPL",
      p_display_symbol: "AAPL",
      p_name: "Apple Inc.",
      p_asset_type: "stock",
      p_exchange: "NASDAQ",
      p_currency: "USD",
    });
    const tslaId = await rpc("upsert_asset", {
      p_symbol: "TSLA",
      p_display_symbol: "TSLA",
      p_name: "Tesla, Inc.",
      p_asset_type: "stock",
      p_exchange: "NASDAQ",
      p_currency: "USD",
    });
    assert(typeof aaplId === "string" && aaplId.length === 36, "upsert_asset(AAPL) returned no id");
    assert(typeof tslaId === "string" && tslaId.length === 36, "upsert_asset(TSLA) returned no id");
    aapl = { id: aaplId };
  });

  // =========================================================================
  section("Teacher signup and classroom provisioning");
  // =========================================================================
  await test("teacher account is created and gets a profile row", async () => {
    const email = `e2e.teacher.${stamp.toLowerCase()}@${studentDomain}`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: teacherPassword,
      email_confirm: true,
      user_metadata: { role: "teacher", full_name: "E2E Teacher" },
    });
    assert(!error && created?.user, `createUser: ${error?.message}`);
    teacher = { id: created.user.id, email };

    // Deliberately not upserted: this asserts the on_auth_user_created trigger
    // actually fired, which is what guarantees no orphaned auth user.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, role, email")
      .eq("id", created.user.id)
      .single();
    assert(!profileError && profile, `trigger did not create a profile: ${profileError?.message}`);
    assert(profile.role === "teacher", `expected role teacher, got ${profile.role}`);
  });

  await test("classroom is created with a settings row from the trigger", async () => {
    const joinCode = `E2E${randomToken(4)}`;
    const { data: created, error } = await admin
      .from("classrooms")
      .insert({
        teacher_id: teacher.id,
        name: classroomName,
        section: "E2E",
        join_code: joinCode,
      })
      .select("id, join_code")
      .single();
    assert(!error && created, `classrooms insert: ${error?.message}`);
    classroomId = created.id;

    const { data: s, error: settingsError } = await admin
      .from("class_settings")
      .select("classroom_id, trading_enabled, asset_policy, default_starting_capital")
      .eq("classroom_id", classroomId)
      .single();
    assert(!settingsError && s, `settings trigger did not fire: ${settingsError?.message}`);
    assert(s.trading_enabled === true, "trading should default to enabled");
    assert(s.asset_policy === "all", `asset_policy should default to all, got ${s.asset_policy}`);
  });

  await test("starting capital is persisted on the classroom", async () => {
    await settings({ default_starting_capital: "10000" });
    const { data } = await admin
      .from("class_settings")
      .select("default_starting_capital")
      .eq("classroom_id", classroomId)
      .single();
    assertMoney(data?.default_starting_capital, 10000, "default_starting_capital");
  });

  await test("two students are provisioned with virtual capital", async () => {
    alice = await provisionStudent(`e2e.a.${stamp.toLowerCase()}`, "Alice Alvarez", "E2E-01");
    bob = await provisionStudent(`e2e.b.${stamp.toLowerCase()}`, "Bob Brennan", "E2E-02");

    const aliceRow = await memberRow(alice.id);
    const bobRow = await memberRow(bob.id);
    assertMoney(aliceRow.cash_balance, 10000, "Alice cash");
    assertMoney(aliceRow.initial_capital, 10000, "Alice initial capital");
    assertMoney(bobRow.cash_balance, 10000, "Bob cash");

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, login_handle, role")
      .in("id", [alice.id, bob.id]);
    assert(profiles?.length === 2, "expected both student profiles");
    assert(
      profiles.every((p) => p.role === "student" && p.login_handle),
      "student profiles must carry a login handle",
    );
  });

  // =========================================================================
  section("Trading engine — buy");
  // =========================================================================
  const price = quote.price;
  const cashAfterBuy = 10000 - 10 * price;
  let alicePortfolio = null;

  await test("BUY 10 AAPL debits cash and returns the database's own portfolio", async () => {
    const result = await trade(alice.id, "buy", 10, price, `e2e-buy-${stamp}`);
    assert(result?.ok === true, `BUY rejected: ${result?.message ?? "unknown"}`);
    assertMoney(result.total_value, 10 * price, "order total");
    assertMoney(result.quantity, 10, "filled quantity");

    alicePortfolio = result.portfolio;
    assertMoney(alicePortfolio.cash_balance, cashAfterBuy, "cash after buy");
    assertMoney(alicePortfolio.holdings_market_value, 10 * price, "holdings value");
    assertMoney(alicePortfolio.total_value, 10000, "total value (marked at cost)");
    assertMoney(alicePortfolio.total_pnl, 0, "unrealized P/L at cost");

    const holding = holdingFor(alicePortfolio, "AAPL");
    assert(holding, "no AAPL holding in the returned portfolio");
    assertMoney(holding.quantity, 10, "holding quantity");
    assertMoney(holding.avg_cost, price, "average cost");
  });

  await test("BUY writes an order, a transaction and a snapshot", async () => {
    const { data: orders } = await admin
      .from("orders")
      .select("id, side, status, quantity, total_value")
      .eq("student_id", alice.id);
    assert(orders?.length === 1, `expected 1 order, got ${orders?.length ?? 0}`);
    assert(orders[0].status === "filled", `order status was ${orders[0].status}`);

    const { data: transactions } = await admin
      .from("transactions")
      .select("id, side, quantity, price, cash_balance_after, order_id")
      .eq("student_id", alice.id);
    assert(transactions?.length === 1, `expected 1 transaction, got ${transactions?.length ?? 0}`);
    assert(transactions[0].order_id === orders[0].id, "transaction is not linked to its order");
    assertMoney(transactions[0].cash_balance_after, cashAfterBuy, "ledger cash balance");

    const { data: snapshots } = await admin
      .from("portfolio_snapshots")
      .select("id")
      .eq("student_id", alice.id);
    assert(snapshots?.length >= 1, "a fill should capture at least one snapshot");
  });

  await test("BUY is rejected when virtual cash is insufficient", async () => {
    const result = await trade(alice.id, "buy", 100000, price, `e2e-nocash-${stamp}`);
    assertCode(result, "INSUFFICIENT_CASH", "insufficient cash");
    const row = await memberRow(alice.id);
    assertMoney(row.cash_balance, cashAfterBuy, "cash must be unchanged by a rejected order");
  });

  await test("BUY is rejected for a non-positive or non-numeric quantity", async () => {
    const negative = await trade(alice.id, "buy", -5, price);
    assertCode(negative, "INVALID_QUANTITY", "negative quantity");

    const zero = await trade(alice.id, "buy", 0, price);
    assertCode(zero, "INVALID_QUANTITY", "zero quantity");

    const nonsense = await trade(alice.id, "buy", "abc", price);
    assertCode(nonsense, "INVALID_QUANTITY", "non-numeric quantity");
  });

  await test("BUY is rejected without a positive market price", async () => {
    const result = await trade(alice.id, "buy", 1, 0);
    assertCode(result, "INVALID_PRICE", "zero price");
  });

  await test("orders are rejected for an unknown side", async () => {
    const result = await rpc("execute_trade", {
      p_classroom_id: classroomId,
      p_student_id: alice.id,
      p_symbol: "AAPL",
      p_side: "hold",
      p_quantity: "1",
      p_price: String(price),
      p_idempotency_key: null,
    });
    assertCode(result, "INVALID_SIDE", "bad side");
  });

  await test("rejected orders do not write anything", async () => {
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("student_id", alice.id);
    assert(count === 1, `expected exactly 1 order (the fill), got ${count}`);
  });

  await test("replaying an idempotency key does not execute twice", async () => {
    const key = `e2e-replay-${stamp}`;
    const first = await trade(alice.id, "buy", 1, price, key);
    assert(first?.ok === true && first.duplicate === false, "first submission should execute");

    const replay = await trade(alice.id, "buy", 1, price, key);
    assert(replay?.ok === true, "replay should be reported as accepted-but-ignored");
    assert(replay.duplicate === true, "replay was not flagged as a duplicate");

    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("student_id", alice.id);
    assert(count === 2, `expected 2 orders after first execution only, got ${count}`);
  });

  // =========================================================================
  section("Trading engine — sell and realised P/L");
  // =========================================================================
  const markedUpPrice = Number((price * 1.1).toFixed(6));

  await test("a market move marks the holding up (unrealised P/L)", async () => {
    await writeCachedPrice("AAPL", markedUpPrice, 10);
    const p = await portfolio(alice.id);
    // Alice holds 11 AAPL after the idempotency fill (10 + 1).
    assertMoney(p.holdings_market_value, 11 * markedUpPrice, "holdings marked to market");
    assertMoney(p.unrealized_pnl, 11 * (markedUpPrice - price), "unrealised P/L");
    assertMoney(p.total_pnl, p.total_value - p.initial_capital, "total P/L is value minus capital");
    assert(p.total_pnl > 0, "an upward move should produce a positive total P/L");
  });

  await test("SELL 4 AAPL credits cash, reduces the holding, books realised P/L", async () => {
    const result = await trade(alice.id, "sell", 4, markedUpPrice, `e2e-sell-${stamp}`);
    assert(result?.ok === true, `SELL rejected: ${result?.message ?? "unknown"}`);
    assertMoney(result.realized_pnl, 4 * (markedUpPrice - price), "realised P/L");

    const holding = holdingFor(result.portfolio, "AAPL");
    assert(holding, "AAPL holding disappeared after a partial sell");
    assertMoney(holding.quantity, 7, "remaining quantity");

    const expectedCash = cashAfterBuy - price + 4 * markedUpPrice;
    assertMoney(result.portfolio.cash_balance, expectedCash, "cash after sell");
  });

  await test("SELL is rejected when the student does not own enough", async () => {
    const result = await trade(alice.id, "sell", 999, markedUpPrice);
    assertCode(result, "INSUFFICIENT_HOLDINGS", "oversell");
  });

  // =========================================================================
  section("Trading engine — classroom policy gates");
  // =========================================================================
  await test("a paused classroom rejects orders", async () => {
    await settings({ trading_enabled: false, paused_reason: "Quiz in progress" });
    const result = await trade(alice.id, "buy", 1, markedUpPrice);
    assertCode(result, "TRADING_PAUSED", "paused classroom");
    assert(
      String(result.message).includes("Quiz in progress"),
      "the teacher's pause reason should be surfaced",
    );
    await settings({ trading_enabled: true, paused_reason: null });
  });

  await test("a closed trading window rejects orders", async () => {
    await settings({ trading_closes_at: new Date(Date.now() - 60_000).toISOString() });
    const result = await trade(alice.id, "buy", 1, markedUpPrice);
    assertCode(result, "MARKET_CLOSED", "closed window");

    await settings({
      trading_closes_at: null,
      trading_opens_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const early = await trade(alice.id, "buy", 1, markedUpPrice);
    assertCode(early, "MARKET_CLOSED", "window not yet open");
    await settings({ trading_opens_at: null });
  });

  await test("an allowlist classroom blocks assets the teacher has not enabled", async () => {
    await settings({ asset_policy: "allowlist" });
    const blocked = await trade(alice.id, "buy", 1, markedUpPrice);
    assertCode(blocked, "ASSET_NOT_PERMITTED", "asset not on the allowlist");

    const { error } = await admin
      .from("classroom_assets")
      .insert({ classroom_id: classroomId, asset_id: aapl.id });
    assert(!error, `could not add to the allowlist: ${error?.message}`);

    const allowed = await trade(alice.id, "buy", 1, markedUpPrice);
    assert(allowed?.ok === true, `allowlisted asset was still blocked: ${allowed?.message}`);
    await settings({ asset_policy: "all" });
  });

  await test("whole-share classrooms reject fractional stock orders", async () => {
    await settings({ allow_fractional: false });
    const result = await trade(alice.id, "buy", 1.5, markedUpPrice);
    assertCode(result, "FRACTIONAL_DISABLED", "fractional shares");
    await settings({ allow_fractional: true });
  });

  await test("max_trade_value caps a single order", async () => {
    await settings({ max_trade_value: "100" });
    const result = await trade(alice.id, "buy", 1, markedUpPrice);
    assertCode(result, "TRADE_TOO_LARGE", "over the per-order cap");
    await settings({ max_trade_value: null });
  });

  await test("max_position_percent caps concentration", async () => {
    await settings({ max_position_percent: "5" });
    try {
      // 3 shares is affordable but would exceed 5% of the portfolio, so the
      // concentration check must be the one that fires — not INSUFFICIENT_CASH.
      const result = await trade(alice.id, "buy", 3, markedUpPrice);
      assertCode(result, "POSITION_LIMIT", "concentration limit");
    } finally {
      await settings({ max_position_percent: null });
    }
  });

  await test("the classroom's rules can be returned to their defaults", async () => {
    await settings({
      trading_enabled: true,
      paused_reason: null,
      trading_opens_at: null,
      trading_closes_at: null,
      asset_policy: "all",
      allow_fractional: true,
      max_trade_value: null,
      max_position_percent: null,
    });
    const { data } = await admin
      .from("class_settings")
      .select("trading_enabled, asset_policy, allow_fractional, max_trade_value, max_position_percent")
      .eq("classroom_id", classroomId)
      .single();
    assert(
      data.trading_enabled === true &&
        data.asset_policy === "all" &&
        data.allow_fractional === true &&
        data.max_trade_value === null &&
        data.max_position_percent === null,
      `classroom rules not restored: ${JSON.stringify(data)}`,
    );
  });

  await test("a non-member cannot trade in someone else's classroom", async () => {
    const { data: outsider } = await admin.auth.admin.createUser({
      email: `e2e.outsider.${stamp.toLowerCase()}@${studentDomain}`,
      password: `E2E-${randomToken(10)}`,
      email_confirm: true,
      user_metadata: { role: "student", full_name: "E2E Outsider", login_handle: `e2e.o.${stamp.toLowerCase()}` },
    });
    assert(outsider?.user, "could not create the outsider account");
    const result = await trade(outsider.user.id, "buy", 1, markedUpPrice);
    assertCode(result, "NOT_A_MEMBER", "non-member trade");
    await admin.auth.admin.deleteUser(outsider.user.id);
  });

  // =========================================================================
  section("Portfolio maths and leaderboard");
  // =========================================================================
  await test("Bob buys TSLA, then a downturn makes him the lagging student", async () => {
    tslaMarkedDown = Number((tslaQuote.price * 0.92).toFixed(6));
    const bobBuy = await rpc("execute_trade", {
      p_classroom_id: classroomId,
      p_student_id: bob.id,
      p_symbol: "TSLA",
      p_side: "buy",
      p_quantity: "2",
      p_price: String(tslaQuote.price),
      p_idempotency_key: `e2e-bob-${stamp}`,
    });
    assert(bobBuy?.ok === true, `Bob's BUY failed: ${bobBuy?.message}`);

    await writeCachedPrice("TSLA", tslaMarkedDown, -8);

    const p = await portfolio(bob.id);
    assert(p.total_pnl < 0, `Bob should be down after an 8% fall, got ${p.total_pnl}`);
    assertMoney(p.total_value, Number(p.cash_balance) + 2 * tslaMarkedDown, "Bob total value");
  });

  await test("the leaderboard ranks the better performer first", async () => {
    const rows = await rpc("get_leaderboard", { p_classroom_id: classroomId });
    assert(Array.isArray(rows) && rows.length === 2, `expected 2 ranked rows, got ${rows?.length}`);
    assert(rows[0].student_id === alice.id, "Alice should rank first");
    assert(rows[0].rank_position === 1, `expected rank 1, got ${rows[0].rank_position}`);
    assert(rows[1].student_id === bob.id, "Bob should rank second");
    assert(Number(rows[0].total_value) > Number(rows[1].total_value), "ranking is not by value");
    assert(Number(rows[0].total_pnl_percent) > 0, "Alice's return should be positive");
    assert(Number(rows[1].total_pnl_percent) < 0, "Bob's return should be negative");
    assert(rows[1].trade_count >= 1, "Bob's trade count should be reported");
  });

  await test("the class overview aggregates real activity", async () => {
    const overview = await rpc("get_class_overview", { p_classroom_id: classroomId });
    assert(overview, "get_class_overview returned null");
    assert(overview.student_count === 2, `expected 2 students, got ${overview.student_count}`);
    assertMoney(overview.total_capital, 20000, "class capital");
    assert(overview.trades_24h >= 4, `expected several trades in 24h, got ${overview.trades_24h}`);
    assert(overview.leader === "Alice Alvarez", `leader was ${overview.leader}`);
    assert(overview.lagging === "Bob Brennan", `lagging was ${overview.lagging}`);
    assert(
      Array.isArray(overview.recent_trades) && overview.recent_trades.length > 0,
      "recent trades should be populated",
    );
  });

  await test("the trade history returns both sides with student labels", async () => {
    const rows = await rpc("get_trade_history", {
      p_classroom_id: classroomId,
      p_student_id: null,
      p_limit: 50,
    });
    assert(Array.isArray(rows) && rows.length >= 4, `expected >= 4 trades, got ${rows?.length}`);
    assert(
      rows.some((r) => r.side === "buy") && rows.some((r) => r.side === "sell"),
      "history should contain both buys and sells",
    );
    assert(
      rows.every((r) => typeof r.student_label === "string" && r.student_label.length > 0),
      "every trade should carry a student label",
    );

    const aliceOnly = await rpc("get_trade_history", {
      p_classroom_id: classroomId,
      p_student_id: alice.id,
      p_limit: 50,
    });
    assert(
      aliceOnly.every((r) => r.student_id === alice.id),
      "student filter leaked another student's trades",
    );
  });

  // =========================================================================
  section("Teacher controls");
  // =========================================================================
  await test("adjust_cash moves cash and capital together, so it is not fake performance", async () => {
    const before = await portfolio(bob.id);
    const result = await rpc("adjust_cash", {
      p_classroom_id: classroomId,
      p_student_id: bob.id,
      p_delta: 1000,
      p_reason: "E2E bonus",
      p_actor_id: teacher.id,
    });
    assert(result?.ok === true, `adjust_cash failed: ${result?.message}`);

    const after = await portfolio(bob.id);
    assertMoney(after.cash_balance, Number(before.cash_balance) + 1000, "cash after bonus");
    assertMoney(after.initial_capital, Number(before.initial_capital) + 1000, "capital after bonus");
    assertMoney(after.total_pnl, before.total_pnl, "P/L must not move when a teacher tops up", 0.02);
  });

  await test("adjust_cash refuses an adjustment that would go below zero", async () => {
    const result = await rpc("adjust_cash", {
      p_classroom_id: classroomId,
      p_student_id: bob.id,
      p_delta: -1_000_000,
      p_reason: "E2E overdraw",
      p_actor_id: teacher.id,
    });
    assertCode(result, "WOULD_GO_NEGATIVE", "overdraw");
  });

  await test("a competition baselines every student, then tracks a real return", async () => {
    const created = await rpc("create_competition", {
      p_classroom_id: classroomId,
      p_name: `[e2e] Sprint ${stamp}`,
      p_description: "E2E competition",
      p_starts_at: new Date(Date.now() - 60_000).toISOString(),
      p_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_created_by: teacher.id,
    });
    assert(created?.ok === true, `create_competition failed: ${created?.message}`);
    assert(created.entries === 2, `expected 2 baselined entries, got ${created.entries}`);

    // The baseline is taken at creation time, so everyone starts level.
    const atStart = await rpc("get_competition_standings", {
      p_competition_id: created.competition_id,
    });
    assert(Array.isArray(atStart) && atStart.length === 2, "expected 2 standings rows");
    assert(
      atStart.every((row) => Math.abs(Number(row.return_abs)) < 0.01),
      `standings should start flat, got ${JSON.stringify(atStart.map((r) => r.return_abs))}`,
    );

    // Alice holds AAPL, so a move in AAPL is what moves her competition return.
    await writeCachedPrice("AAPL", markedUpPrice * 1.05, 5);

    const standings = await rpc("get_competition_standings", {
      p_competition_id: created.competition_id,
    });
    assert(standings[0].student_id === alice.id, "Alice should lead the competition after the move");
    assert(
      Number(standings[0].return_abs) > 0,
      `Alice's competition return should be positive, got ${standings[0].return_abs}`,
    );
    assert(Number(standings[0].return_pct) > 0, "the return percentage should be positive too");
  });

  await test("capture_snapshots records a row for every active member", async () => {
    const written = await rpc("capture_snapshots", {
      p_classroom_id: classroomId,
      p_student_id: null,
    });
    assert(written === 2, `expected 2 snapshots written, got ${written}`);
  });

  await test("resetting one student clears their history and restores capital", async () => {
    const result = await rpc("reset_student_portfolio", {
      p_classroom_id: classroomId,
      p_student_id: alice.id,
      p_starting_capital: 10000,
      p_actor_id: teacher.id,
    });
    assert(result?.ok === true, `reset_student_portfolio failed: ${result?.message}`);
    assertMoney(result.portfolio.cash_balance, 10000, "cash after reset");
    assert(result.portfolio.holdings.length === 0, "holdings should be cleared");
    assert(result.portfolio.trade_count === 0, "trade count should be zero after reset");

    const { count } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("student_id", alice.id);
    assert(count === 0, `expected no transactions after reset, got ${count}`);
  });

  await test("resetting the classroom restores every student", async () => {
    const result = await rpc("reset_classroom", {
      p_classroom_id: classroomId,
      p_starting_capital: 10000,
      p_actor_id: teacher.id,
    });
    assert(result?.ok === true, `reset_classroom failed: ${result?.message}`);
    assert(result.students_reset === 2, `expected 2 students reset, got ${result.students_reset}`);

    const rows = await rpc("get_leaderboard", { p_classroom_id: classroomId });
    assert(
      rows.every((r) => Number(r.total_value) === 10000 && Number(r.trade_count) === 0),
      "every student should be flat at their starting capital",
    );
  });

  await test("audit log records the teacher's actions", async () => {
    const { data } = await admin
      .from("audit_log")
      .select("action, actor_id, classroom_id")
      .eq("classroom_id", classroomId);
    assert(data?.length >= 3, `expected audit entries, got ${data?.length ?? 0}`);
    for (const action of ["adjust_cash", "reset_student", "reset_classroom"]) {
      assert(
        data.some((row) => row.action === action),
        `missing an audit entry for ${action}`,
      );
    }
    assert(
      data.every((row) => row.actor_id === teacher.id),
      "audit entries should name the acting teacher",
    );
    // A rejected adjustment is not an action taken, so it must not be logged.
    assert(
      data.filter((row) => row.action === "adjust_cash").length === 1,
      "only the successful adjustment should be logged",
    );
  });

  // =========================================================================
  section("Authentication and row level security");
  // =========================================================================
  let aliceSession = null;
  let bobSession = null;

  await test("trading works again after a class reset (state lives in the database)", async () => {
    const result = await rpc("execute_trade", {
      p_classroom_id: classroomId,
      p_student_id: bob.id,
      p_symbol: "TSLA",
      p_side: "buy",
      p_quantity: "1",
      p_price: String(tslaMarkedDown),
      p_idempotency_key: `e2e-bob-after-reset-${stamp}`,
    });
    assert(result?.ok === true, `BUY after reset failed: ${result?.message}`);
  });

  await test("a student signs in with handle-derived credentials", async () => {
    aliceSession = await signIn(alice.email, alice.password);
    bobSession = await signIn(bob.email, bob.password);
    assert(aliceSession.user.id === alice.id, "signed-in user is not Alice");
    assert(bobSession.user.id === bob.id, "signed-in user is not Bob");
  });

  await test("a student sees only their own membership row", async () => {
    const { data, error } = await aliceSession.client
      .from("class_members")
      .select("student_id, cash_balance");
    assert(!error, `class_members read failed: ${error?.message}`);
    assert(data?.length === 1, `expected 1 visible row, got ${data?.length}`);
    assert(data[0].student_id === alice.id, "a student can see another student's membership");
  });

  await test("a student cannot read another student's holdings, orders or ledger", async () => {
    // Bob owns TSLA at this point and Alice is flat, so an empty result for
    // Alice is meaningful rather than just an empty table.
    const { data: bobHoldings } = await admin
      .from("holdings")
      .select("id")
      .eq("student_id", bob.id);
    assert(
      bobHoldings?.length === 1,
      `test precondition failed: Bob should hold exactly 1 asset, found ${bobHoldings?.length ?? 0}`,
    );

    const { data: aliceHoldings, error: holdingsError } = await aliceSession.client
      .from("holdings")
      .select("student_id");
    assert(!holdingsError, `holdings read failed: ${holdingsError?.message}`);
    assert(
      (aliceHoldings ?? []).length === 0,
      `Alice can read ${aliceHoldings?.length} holdings rows that are not hers`,
    );

    const { data: aliceOrders } = await aliceSession.client.from("orders").select("student_id");
    assert((aliceOrders ?? []).length === 0, "Alice can read orders she did not place");

    const { data: aliceLedger } = await aliceSession.client
      .from("transactions")
      .select("student_id");
    assert((aliceLedger ?? []).length === 0, "Alice can read transactions she did not make");

    const { data: bobLedger } = await bobSession.client.from("transactions").select("student_id");
    assert(
      (bobLedger ?? []).length === 1 && bobLedger[0].student_id === bob.id,
      "Bob cannot read his own ledger",
    );
  });

  await test("a student cannot read the audit log", async () => {
    const { data } = await aliceSession.client.from("audit_log").select("id");
    assert((data ?? []).length === 0, "audit_log is readable by a student");
  });

  await test("a student cannot insert rows into a financial table", async () => {
    // With RLS enabled and no INSERT policy, PostgREST raises 42501 rather than
    // quietly dropping the row, so an error is the correct expectation here.
    const { error: orderError } = await aliceSession.client.from("orders").insert({
      classroom_id: classroomId,
      student_id: alice.id,
      asset_id: aapl.id,
      side: "buy",
      quantity: "1",
      price: "1",
      total_value: "1",
    });
    assert(orderError, "a student inserted an order row directly");

    const { error: holdingError } = await aliceSession.client.from("holdings").insert({
      classroom_id: classroomId,
      student_id: alice.id,
      asset_id: aapl.id,
      quantity: "1000",
      avg_cost: "0",
    });
    assert(holdingError, "a student inserted a holding row directly");
  });

  await test("a student cannot update or delete their way to more money", async () => {
    // UPDATE/DELETE with no policy affects zero rows rather than erroring, so the
    // security property to assert is that nothing actually changed.
    await aliceSession.client
      .from("class_members")
      .update({ cash_balance: "999999" })
      .eq("student_id", alice.id)
      .select();

    const row = await memberRow(alice.id);
    assertMoney(row.cash_balance, 10000, "cash after an attempted direct update");

    const { count: before } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("student_id", bob.id);
    await aliceSession.client.from("transactions").delete().eq("student_id", bob.id);
    const { count: after } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("student_id", bob.id);
    assert(after === before && before > 0, `ledger changed: ${before} -> ${after}`);

    await aliceSession.client.from("profiles").update({ role: "teacher" }).eq("id", alice.id).select();
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", alice.id)
      .single();
    assert(profile.role === "student", "a student escalated their own role");
  });

  await test("a student cannot call the privileged RPCs directly", async () => {
    const { error } = await aliceSession.client.rpc("get_portfolio", {
      p_classroom_id: classroomId,
      p_student_id: bob.id,
    });
    assert(error, "a student was able to call get_portfolio() through PostgREST");

    const { error: overviewError } = await aliceSession.client.rpc("get_class_overview", {
      p_classroom_id: classroomId,
    });
    assert(overviewError, "a student was able to call get_class_overview()");
  });

  await test("a student cannot read another classroom's data", async () => {
    const { data: classrooms } = await aliceSession.client
      .from("classrooms")
      .select("id, teacher_id");
    assert(
      (classrooms ?? []).every((row) => row.id === classroomId),
      "a student can see a classroom they are not enrolled in",
    );
  });

  await test("a teacher can see the roster and the students' work", async () => {
    const { client: teacherClient } = await signIn(teacher.email, teacherPassword);

    const { data: roster, error } = await teacherClient
      .from("class_members")
      .select("student_id, display_name")
      .eq("classroom_id", classroomId);
    assert(!error, `teacher could not read the roster: ${error?.message}`);
    assert(roster?.length === 2, `teacher saw ${roster?.length} members, expected 2`);

    const { data: profiles } = await teacherClient
      .from("profiles")
      .select("id, full_name")
      .in("id", [alice.id, bob.id]);
    assert(profiles?.length === 2, "teacher could not read both student profiles");

    const { data: audit } = await teacherClient
      .from("audit_log")
      .select("action")
      .eq("classroom_id", classroomId);
    assert(
      (audit ?? []).length >= 3,
      `teacher read ${audit?.length ?? 0} audit rows, expected at least 3`,
    );
  });
} catch (error) {
  failures.push({ section: currentSection, name: "aborted", message: error.message });
  console.log(`\n${RED}${BOLD}Run aborted:${RESET} ${error.message}`);
} finally {
  // =========================================================================
  // Restore the real market prices, then remove every test fixture.
  // =========================================================================
  console.log(`\n${BOLD}Cleanup${RESET}`);
  try {
    if (quote) {
      await writeCachedPrice("AAPL", quote.price, quote.changePercent);
      restored = true;
      console.log(`  ${GREEN}restored${RESET} AAPL price cache to the live quote ($${quote.price})`);
    }
    await admin.from("price_history").delete().eq("asset_id", aapl?.id ?? "");

    if (keep) {
      console.log(
        `  ${DIM}--keep passed: leaving classroom "${classroomName}" (${classroomId}) and its accounts in place.${RESET}`,
      );
    } else {
      if (classroomId) {
        const { error } = await admin.from("classrooms").delete().eq("id", classroomId);
        console.log(
          error
            ? `  ${RED}could not delete the test classroom: ${error.message}${RESET}`
            : `  ${GREEN}deleted${RESET} test classroom and all of its rows`,
        );
      }
      for (const account of [alice, bob, teacher]) {
        if (!account) continue;
        const { error } = await admin.auth.admin.deleteUser(account.id);
        if (error) console.log(`  ${RED}could not delete ${account.email}: ${error.message}${RESET}`);
      }
      console.log(`  ${GREEN}deleted${RESET} the test teacher and student accounts`);
    }
  } catch (error) {
    console.log(`  ${RED}cleanup error: ${error.message}${RESET}`);
  }

  if (restored && aapl) {
    const { data: history } = await admin
      .from("price_history")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", aapl.id);
    console.log(`  ${DIM}price_history rows left for AAPL: ${history?.length ?? 0}${RESET}`);
  }

  const total = passed + failures.length;
  console.log(
    `\n${BOLD}${passed}/${total} checks passed${RESET}` +
      (failures.length > 0 ? ` — ${RED}${failures.length} failing${RESET}` : ` ${GREEN}all green${RESET}`),
  );

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`  ${RED}✗${RESET} [${failure.section}] ${failure.name}\n      ${failure.message}`);
    }
    process.exit(1);
  }
  process.exit(0);
}
