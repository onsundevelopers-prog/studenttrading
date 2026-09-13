import { NextResponse } from "next/server";

import { getSessionContext, resolveActiveClassroom } from "@/lib/auth/session";
import { searchMarket } from "@/lib/market/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchSchema } from "@/lib/validation";

/**
 * Asset search for the student and teacher market views.
 *
 * Requires a signed-in user: market data costs quota, and an unauthenticated
 * endpoint would be a free proxy for anyone who found the URL.
 */
export async function GET(request: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json(
      { ok: false, reason: "You don't have permission to access this resource." },
      { status: 401 },
    );
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";
  const parsed = searchSchema.safeParse(query);
  if (!parsed.success) {
    return NextResponse.json({ ok: true, hits: [] });
  }

  const outcome = await searchMarket(parsed.data);
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, reason: outcome.reason }, { status: 200 });
  }

  // Flag which results this classroom is actually allowed to trade, so the
  // search list can show a lock rather than letting a student discover the
  // restriction only after filling in an order.
  let permittedSymbols: Set<string> | null = null;

  const classroom = await resolveActiveClassroom(session);
  if (classroom) {
    const admin = createAdminClient();
    const { data: settings } = await admin
      .from("class_settings")
      .select("asset_policy")
      .eq("classroom_id", classroom.id)
      .maybeSingle();

    if (settings?.asset_policy === "allowlist") {
      const { data } = await admin
        .from("classroom_assets")
        .select("assets ( symbol )")
        .eq("classroom_id", classroom.id);

      permittedSymbols = new Set(
        (data ?? [])
          .map((row) => {
            const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
            return asset?.symbol as string | undefined;
          })
          .filter((symbol): symbol is string => Boolean(symbol)),
      );
    }
  }

  return NextResponse.json({
    ok: true,
    hits: outcome.hits.map((hit) => ({
      ...hit,
      permitted: permittedSymbols === null ? true : permittedSymbols.has(hit.symbol),
    })),
  });
}
