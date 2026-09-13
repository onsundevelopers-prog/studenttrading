"use server";

import { revalidatePath } from "next/cache";

import { NOT_MEMBER_MESSAGE, isClassroomStudent } from "@/lib/auth/guards";
import { requireStudent } from "@/lib/auth/session";
import { ensureAsset, getQuote, getQuotes } from "@/lib/market/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapPortfolio, type Portfolio } from "@/lib/types";
import { firstIssue, tradeSchema } from "@/lib/validation";

/**
 * The simulated trading engine.
 *
 * Order of operations, and why:
 *  1. Authenticate the student (session cookie, verified against the auth
 *     server).
 *  2. Confirm they are an active member of the classroom they claim to be
 *     trading in. The client cannot talk its way into another classroom.
 *  3. Resolve the asset server-side from the symbol.
 *  4. Fetch the price from the market data service. The browser never supplies a
 *     price; if the provider is down we say so instead of guessing.
 *  5. Hand quantity and price to `execute_trade` as strings so PostgreSQL keeps
 *     them as `numeric`. That function re-validates cash, ownership, trading
 *     status, asset permission and position limits, under a row lock, and
 *     writes cash + holdings + order + transaction as one unit.
 *
 * The result returned to the client is the database's own recomputation of the
 * portfolio, not something assembled in JavaScript.
 */

/** Result handed back to the trade panel. `portfolio` is the database's own
 * recomputation, so the UI can update without a second round trip. */
export type TradeActionState = {
  ok: boolean;
  message: string;
  portfolio?: Portfolio | null;
} | null;

function revalidateAfterTrade(): void {
  revalidatePath("/student", "layout");
  revalidatePath("/teacher", "layout");
}

/** Refresh the cached prices of everything a student currently holds. */
async function refreshHeldPrices(
  classroomId: string,
  studentId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("holdings")
    .select("assets ( symbol )")
    .eq("classroom_id", classroomId)
    .eq("student_id", studentId)
    .gt("quantity", 0);

  const symbols = (data ?? [])
    .map((row) => {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      return asset?.symbol as string | undefined;
    })
    .filter((symbol): symbol is string => Boolean(symbol));

  if (symbols.length > 0) await getQuotes(symbols);
}

export async function executeTradeAction(
  _previous: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const session = await requireStudent();

  const parsed = tradeSchema.safeParse({
    classroomId: formData.get("classroomId"),
    symbol: formData.get("symbol"),
    side: formData.get("side"),
    quantity: formData.get("quantity"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const { classroomId, symbol, side, quantity, idempotencyKey } = parsed.data;

  if (!(await isClassroomStudent(classroomId, session.userId))) {
    return { ok: false, message: NOT_MEMBER_MESSAGE };
  }

  const asset = await ensureAsset(symbol);
  if (!asset.ok) return { ok: false, message: asset.reason };

  const quoteResult = await getQuote(symbol, { maxAgeSeconds: 30 });
  if (!quoteResult.ok) return { ok: false, message: quoteResult.reason };

  if (quoteResult.quote.stale) {
    return {
      ok: false,
      message:
        "Market data is temporarily unavailable, so this trade was not placed. Try again shortly.",
    };
  }

  const price = quoteResult.quote.price;

  // Keep the rest of the portfolio marked at current prices so the value we
  // return (and the concentration limits the database enforces) are meaningful.
  await refreshHeldPrices(classroomId, session.userId);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("execute_trade", {
    p_classroom_id: classroomId,
    p_student_id: session.userId,
    p_symbol: symbol,
    p_side: side,
    p_quantity: quantity,
    p_price: price.toString(),
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    return {
      ok: false,
      message:
        "The trade could not be processed. Nothing was bought or sold. Please try again.",
    };
  }

  const result = data as {
    ok: boolean;
    code?: string;
    message?: string;
    duplicate?: boolean;
    side?: "buy" | "sell";
    display_symbol?: string;
    symbol?: string;
    quantity?: string;
    price?: string;
    total_value?: string;
    realized_pnl?: string;
    portfolio?: unknown;
  } | null;

  if (!result?.ok) {
    return { ok: false, message: result?.message ?? "That trade was rejected." };
  }

  const portfolio = mapPortfolio(result.portfolio);
  revalidateAfterTrade();

  const displaySymbol = result.display_symbol ?? symbol;
  const filled = Number(result.quantity ?? quantity);
  const filledValue = Number(result.total_value ?? 0);

  return {
    ok: true,
    message: result.duplicate
      ? "That order was already submitted — nothing was placed twice."
      : `${side === "buy" ? "Bought" : "Sold"} ${filled.toLocaleString("en-US", {
          maximumFractionDigits: 8,
        })} ${displaySymbol} for $${filledValue.toFixed(2)}.`,
    portfolio,
  };
}
