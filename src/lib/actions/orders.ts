"use server";

import { revalidatePath } from "next/cache";

import { NOT_MEMBER_MESSAGE, isClassroomStudent } from "@/lib/auth/guards";
import { requireStudent } from "@/lib/auth/session";
import { ensureAsset, getQuote } from "@/lib/market/service";
import { getMarketStatusFor } from "@/lib/market/market-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstIssue, placeOrderSchema } from "@/lib/validation";

/**
 * Order intake for the extended trading engine (spec §4).
 *
 * Market orders are placed AND filled in one round trip: the price comes from
 * the same cached quote the database validates against, and `execute_trade`
 * does the money maths under a row lock. Limit/stop/stop-limit orders are
 * parked as `pending` by `place_order` (which reserves cash or shares) and are
 * filled later by the matching worker against live prices — so a resting limit
 * order fills at its own terms, never at the moment of placement.
 *
 * Nothing the client sends is trusted: membership, asset, price, session state,
 * order-type permissions and reserves are all re-derived server-side.
 */

export type OrderActionState = {
  ok: boolean;
  message: string;
  orderId?: string;
  status?: string;
} | null;

/** Per-student order-intake rate limit (spec §14). Sliding window, in-process. */
const RATE_LIMIT = { windowMs: 60_000, max: 20 };
const rateBuckets = new Map<string, number[]>();

function rateLimited(studentId: string): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(studentId) ?? []).filter(
    (ts) => now - ts < RATE_LIMIT.windowMs,
  );
  if (bucket.length >= RATE_LIMIT.max) {
    rateBuckets.set(studentId, bucket);
    return true;
  }
  bucket.push(now);
  rateBuckets.set(studentId, bucket);
  return false;
}

export async function placeOrderAction(
  _previous: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const session = await requireStudent();

  const parsed = placeOrderSchema.safeParse({
    classroomId: formData.get("classroomId"),
    symbol: formData.get("symbol"),
    side: formData.get("side"),
    orderType: formData.get("orderType"),
    quantity: formData.get("quantity"),
    limitPrice: formData.get("limitPrice") ?? "",
    stopPrice: formData.get("stopPrice") ?? "",
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const { classroomId, symbol, side, orderType, quantity, limitPrice, stopPrice, idempotencyKey } =
    parsed.data;

  if (rateLimited(session.userId)) {
    return {
      ok: false,
      message: "Too many orders in a short time. Wait a moment and try again.",
    };
  }

  if (!(await isClassroomStudent(classroomId, session.userId))) {
    return { ok: false, message: NOT_MEMBER_MESSAGE };
  }

  const asset = await ensureAsset(symbol);
  if (!asset.ok) return { ok: false, message: asset.reason };

  // Market orders need a fresh price and fill immediately; resting orders only
  // need the current session state recorded for the order's provenance.
  const status = await getMarketStatusFor(
    symbol.includes(":") ? "crypto" : "stock",
  );

  const admin = createAdminClient();

  const { data: placed, error } = await admin.rpc("place_order", {
    p_classroom_id: classroomId,
    p_student_id: session.userId,
    p_symbol: symbol,
    p_side: side,
    p_order_type: orderType,
    p_quantity: quantity,
    p_limit_price: limitPrice || null,
    p_stop_price: stopPrice || null,
    p_idempotency_key: idempotencyKey,
    p_session_at_placement: status.isEquity ? status.session : null,
  });

  if (error) {
    return {
      ok: false,
      message:
        "The order could not be processed. Nothing was bought or sold. Please try again.",
    };
  }

  const result = placed as {
    ok: boolean;
    code?: string;
    message?: string;
    duplicate?: boolean;
    order_id?: string;
    status?: string;
  } | null;

  if (!result?.ok) {
    return { ok: false, message: result?.message ?? "That order was rejected." };
  }

  if (result.duplicate) {
    return {
      ok: true,
      message: "That order was already submitted — nothing was placed twice.",
      orderId: result.order_id,
      status: result.status,
    };
  }

  revalidatePath("/student", "layout");
  revalidatePath("/teacher", "layout");

  if (orderType === "market") {
    // Fill immediately via the existing engine, using a current price. The
    // database re-checks every rule under lock; if the fill is rejected (cash
    // moved between placement and fill, for example) the order stays on the
    // book as pending/rejected and the student sees the reason.
    const quoteResult = await getQuote(symbol, { maxAgeSeconds: 30 });
    if (!quoteResult.ok || quoteResult.quote.stale) {
      return {
        ok: false,
        message:
          "Order placed, but no fresh price is available to execute it. It will fill on the next market update.",
        orderId: result.order_id,
        status: "pending",
      };
    }

    const { data: filled, error: fillError } = await admin.rpc("fill_order", {
      p_order_id: result.order_id,
      p_price: quoteResult.quote.price.toString(),
    });

    if (fillError) {
      return {
        ok: false,
        message:
          "Order placed, but execution was interrupted. Check your open orders.",
        orderId: result.order_id,
        status: "pending",
      };
    }

    const fillResult = filled as {
      ok: boolean;
      status?: string;
      filled_quantity?: string;
      execution_price?: string;
    } | null;

    if (fillResult?.ok && fillResult.status === "filled") {
      revalidatePath("/student", "layout");
      return {
        ok: true,
        message: `${side === "buy" ? "Bought" : "Sold"} ${Number(
          fillResult.filled_quantity ?? quantity,
        )} ${symbol} at $${Number(fillResult.execution_price ?? 0).toFixed(2)}.`,
        orderId: result.order_id,
        status: "filled",
      };
    }

    return {
      ok: true,
      message:
        fillResult?.status === "rejected"
          ? "Order rejected at execution time."
          : "Order accepted and working.",
      orderId: result.order_id,
      status: fillResult?.status ?? "pending",
    };
  }

  const typeLabel =
    orderType === "stop_limit" ? "stop-limit" : orderType === "limit" ? "limit" : "stop";
  return {
    ok: true,
    message: `${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} order placed. It rests until your price is reached (or it expires).`,
    orderId: result.order_id,
    status: "pending",
  };
}

export async function cancelOrderAction(
  _previous: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const session = await requireStudent();

  const orderId = String(formData.get("orderId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return { ok: false, message: "That order could not be identified." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("cancel_order", {
    p_order_id: orderId,
    p_student_id: session.userId,
  });

  if (error) return { ok: false, message: "Could not cancel that order. Please try again." };

  const result = data as { ok: boolean; message?: string; status?: string } | null;
  if (!result?.ok) return { ok: false, message: result?.message ?? "Could not cancel that order." };

  revalidatePath("/student", "layout");
  return { ok: true, message: "Order cancelled.", status: "cancelled" };
}
