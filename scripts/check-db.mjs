/**
 * Schema check.
 *
 * Confirms that the migration in supabase/migrations/0001_init.sql has been
 * applied to the configured Supabase project, and reports exactly what is
 * missing if it has not. Run this after pasting the migration into the SQL
 * editor, and again any time the app reports that something does not exist.
 *
 *   npm run check:db
 */
import { readFileSync } from "node:fs";

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
const key = env.SUPABASE_SECRET_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SECRET_KEY. Copy .env.example to .env.local first.",
  );
  process.exit(1);
}

const EXPECTED_TABLES = [
  "profiles",
  "classrooms",
  "class_settings",
  "class_members",
  "assets",
  "classroom_assets",
  "holdings",
  "orders",
  "transactions",
  "watchlists",
  "watchlist_items",
  "competitions",
  "competition_entries",
  "portfolio_snapshots",
  "price_history",
  "price_cache",
  "audit_log",
  // 0006 — news cache and the shared Alpha Vantage call counter.
  "news_cache",
  "api_quota",
];

const EXPECTED_FUNCTIONS = [
  "execute_trade",
  "get_portfolio",
  "get_leaderboard",
  "get_class_overview",
  "get_trade_history",
  "get_competition_standings",
  "create_competition",
  "capture_snapshots",
  "adjust_cash",
  "reset_student_portfolio",
  "reset_classroom",
  "upsert_asset",
  // 0006
  "consume_api_quota",
  "remaining_api_quota",
];

async function head(path) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return response.status;
}

console.log(`Checking schema at ${url}\n`);

const missingTables = [];
let reachable = true;

for (const table of EXPECTED_TABLES) {
  let status;
  try {
    status = await head(`${table}?select=*&limit=1`);
  } catch (error) {
    reachable = false;
    console.error(`  network error: ${error.message}`);
    break;
  }
  // 200 = exists, 404 = missing, 401/403 = exists but no grant (still exists)
  if (status === 404) missingTables.push(table);
}

if (!reachable) {
  console.error(
    "\nCould not reach the Supabase REST API. Check NEXT_PUBLIC_SUPABASE_URL and your network.",
  );
  process.exit(1);
}

if (missingTables.length === 0) {
  console.log(`  \u001b[32mOK\u001b[0m all ${EXPECTED_TABLES.length} tables present`);
} else {
  console.log(
    `  \u001b[31mMISSING\u001b[0m ${missingTables.length} of ${EXPECTED_TABLES.length} tables`,
  );
  for (const table of missingTables) console.log(`    - ${table}`);
}

// RPCs are enumerated from PostgREST's OpenAPI document.
//
// Note: probing `rpc/<name>` with a bare GET does NOT work. PostgREST resolves a
// function by its argument list, so a function with required parameters can
// never match a no-arg request — it answers 404 for a function that is very much
// present. That produced a whole page of false "missing" reports. The OpenAPI
// document at the REST root lists every exposed RPC instead.
let rpcNames = null;
try {
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (response.ok) {
    const spec = await response.json();
    rpcNames = new Set(
      Object.keys(spec.paths ?? {})
        .filter((path) => path.startsWith("/rpc/"))
        .map((path) => path.slice("/rpc/".length)),
    );
  }
} catch {
  rpcNames = null;
}

if (rpcNames === null) {
  console.log(
    "  \u001b[33mSKIPPED\u001b[0m function check — could not read the PostgREST OpenAPI document",
  );
} else {
  const missingFunctions = EXPECTED_FUNCTIONS.filter((fn) => !rpcNames.has(fn));

  if (missingFunctions.length === 0) {
    console.log(`  \u001b[32mOK\u001b[0m all ${EXPECTED_FUNCTIONS.length} functions present`);
  } else {
    console.log(
      `  \u001b[31mMISSING\u001b[0m ${missingFunctions.length} of ${EXPECTED_FUNCTIONS.length} functions`,
    );
    for (const fn of missingFunctions) console.log(`    - ${fn}()`);
  }
}


const assetStatus = await head("assets?select=symbol&limit=1");
if (assetStatus === 200) {
  const response = await fetch(`${url}/rest/v1/assets?select=symbol`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const range = response.headers.get("content-range");
  console.log(`  asset universe: ${range ?? "unknown"} rows`);
}

const functionsIncomplete =
  rpcNames !== null && EXPECTED_FUNCTIONS.some((fn) => !rpcNames.has(fn));

// Presence is not correctness. A function can exist and still be broken — 0002
// fixes exactly that, where get_class_overview() referenced a column that does
// not exist and took out the teacher overview while every object still "existed".
// So call the read-only RPCs with a nil id and confirm they answer without a SQL
// error. Nothing is written: these functions only read.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const READ_PROBES = [
  ["get_class_overview", { p_classroom_id: NIL_UUID }],
  ["get_leaderboard", { p_classroom_id: NIL_UUID }],
  ["get_portfolio", { p_classroom_id: NIL_UUID, p_student_id: NIL_UUID }],
  ["get_trade_history", { p_classroom_id: NIL_UUID, p_student_id: null, p_limit: 1 }],
  // Read-only, and consuming nothing: it reports the day's remaining budget.
  ["remaining_api_quota", { p_provider: "alpha_vantage", p_limit: 1 }],
];

const brokenFunctions = [];
let probesSkipped = false;

if (rpcNames !== null) {
  for (const [fn, body] of READ_PROBES) {
    if (!rpcNames.has(fn)) continue;
    let response;
    try {
      response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      brokenFunctions.push(`${fn}(): could not be called (${error.message})`);
      continue;
    }
    if (response.ok) continue;

    const detail = await response.text();
    if (/permission denied/i.test(detail)) {
      // Only a secret key can execute these; a publishable key cannot.
      probesSkipped = true;
      continue;
    }
    brokenFunctions.push(`${fn}(): ${detail.slice(0, 180)}`);
  }

  if (brokenFunctions.length === 0) {
    console.log(
      `  \u001b[32mOK\u001b[0m read paths answer (${READ_PROBES.length} RPCs called with a nil id)` +
        (probesSkipped ? " \u001b[33m[some skipped: need SUPABASE_SECRET_KEY]\u001b[0m" : ""),
    );
  } else {
    console.log(`  \u001b[31mBROKEN\u001b[0m ${brokenFunctions.length} read path(s) failed at runtime`);
    for (const detail of brokenFunctions) console.log(`    - ${detail}`);
  }
}

if (missingTables.length > 0 || functionsIncomplete || brokenFunctions.length > 0) {
  const newsObjectsMissing =
    missingTables.includes("news_cache") ||
    missingTables.includes("api_quota") ||
    EXPECTED_FUNCTIONS.some(
      (fn) =>
        (fn === "consume_api_quota" || fn === "remaining_api_quota") &&
        rpcNames !== null &&
        !rpcNames.has(fn),
    );

  const NEWS_TABLES = ["news_cache", "api_quota"];
  const NEWS_FUNCTIONS = ["consume_api_quota", "remaining_api_quota"];

  // Anything missing that 0001 is responsible for. Missing only the news objects
  // is a different situation with a different fix, so it is reported separately
  // rather than buried under "run 0001", which the user may already have done.
  const otherObjectsMissing =
    missingTables.some((table) => !NEWS_TABLES.includes(table)) ||
    (rpcNames !== null &&
      EXPECTED_FUNCTIONS.some(
        (fn) => !NEWS_FUNCTIONS.includes(fn) && !rpcNames.has(fn),
      ));

  if (otherObjectsMissing) {
    console.log(
      "\n\u001b[1mAction required:\u001b[0m open the Supabase dashboard → SQL Editor → New query, paste the\n" +
        "contents of supabase/migrations/0001_init.sql, and run it. Then re-run npm run check:db.\n",
    );
  }

  if (brokenFunctions.length > 0) {
    console.log(
      "\n\u001b[1mAction required:\u001b[0m an object exists but is out of date. Paste the relevant\n" +
        "migration from supabase/migrations/ into the Supabase SQL editor and run it —\n" +
        "0002_fix_class_overview.sql for the overview above — then re-run npm run check:db.\n" +
        "Every migration is safe to re-run.\n",
    );
  }

  if (newsObjectsMissing) {
    console.log(
      "\n\u001b[1mAction required:\u001b[0m the news cache is not installed. Open the Supabase\n" +
        "dashboard → SQL Editor → New query, paste the contents of\n" +
        "supabase/migrations/0006_news.sql, and run it. News works without it (using an\n" +
        "in-process cache), but the cache stops being shared between instances and the\n" +
        "daily Alpha Vantage budget stops being enforced across them. Then re-run\n" +
        "npm run check:db.\n",
    );
  }

  process.exit(1);
}

console.log("\n\u001b[32mSchema looks complete.\u001b[0m");
