import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { sampleMarketAndSnapshot } from "@/lib/market/service";

/**
 * Scheduled market sampler.
 *
 * Finnhub's free tier exposes no historical candles, so the price and
 * performance charts are built from samples this endpoint collects. Point a
 * Vercel Cron at it every five minutes (see vercel.json) or run it by hand.
 *
 * Protected by a shared secret: it writes to every classroom's snapshot table,
 * so it must not be publicly triggerable.
 */
async function handle(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : new URL(request.url).searchParams.get("secret") ?? "";

  if (!token || token !== serverEnv.cronSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await sampleMarketAndSnapshot();

  return NextResponse.json({
    ok: true,
    sampled: result.sampled,
    failed: result.failed,
    snapshotted: result.snapshotted,
    at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
