import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { getQuotes } from "@/lib/market/service";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Order-matching worker (spec §4).
 *
 * Resting limit/stop/stop-limit orders do not fill at placement — they wait
 * for the market to reach their terms. Point a Vercel Cron at this endpoint
 * every minute (see vercel.json) or trigger it manually:
 *
 *   GET /api/cron/match-orders with `Authorization: Bearer $CRON_SECRET`
 *
 * Each run:
 *  1. expires any resting orders past their expiry (GTC 90 days in the schema)
 *  2. collects every open order's symbol, fetches live prices in batches
 *  3. calls fill_order() per order — it re-checks session terms, cash and
 *     shares under a row lock, so concurrent runs and concurrent students are
 *     both safe
 *
 * Per-run fill attempts are bounded so a large backlog cannot overrun the
 * serverless time limit; the next run picks up where this one stopped.
 */
const MAX_FILLS_PER_RUN = 200;

async function handle(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : new URL(request.url).searchParams.get("secret") ?? "";

  if (!token || token !== serverEnv.cronSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // 1. Expire stale orders first so they never fill after their deadline.
  const { data: expired } = await admin.rpc("expire_stale_orders");
  const expiredCount = Number(expired ?? 0);

  // 2. Open orders in fill priority (oldest first — price-time priority).
  const { data: openOrders, error } = await admin
    .from("orders")
    .select("id, asset_id, assets ( symbol )")
    .in("status", ["pending", "partially_filled"])
    .order("created_at", { ascending: true })
    .limit(MAX_FILLS_PER_RUN);

  if (error) {
    return NextResponse.json({ ok: false, error: "Could not list open orders." }, { status: 500 });
  }

  const rows = openOrders ?? [];
  const symbolByOrder = new Map<string, string>();
  for (const row of rows) {
    const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
    if (asset?.symbol) symbolByOrder.set(row.id, String(asset.symbol));
  }

  // 3. Live prices for everything on the book.
  const { quotes } = await getQuotes(Array.from(new Set(symbolByOrder.values())));

  let filled = 0;
  let rejected = 0;
  let stillOpen = 0;

  for (const row of rows) {
    const symbol = symbolByOrder.get(row.id);
    const quote = symbol ? quotes.get(symbol) : undefined;
    if (!quote || quote.stale) {
      stillOpen += 1; // no trustworthy price this run — leave the order working
      continue;
    }

    const { data: result, error: fillError } = await admin.rpc("fill_order", {
      p_order_id: row.id,
      p_price: quote.price.toString(),
    });

    if (fillError) {
      stillOpen += 1;
      continue;
    }

    const outcome = result as { ok: boolean; status?: string } | null;
    if (outcome?.ok && outcome.status === "filled") filled += 1;
    else if (outcome?.ok && outcome.status === "rejected") rejected += 1;
    else stillOpen += 1;
  }

  return NextResponse.json({
    ok: true,
    expired: expiredCount,
    attempted: rows.length,
    filled,
    rejected,
    stillOpen,
    at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
