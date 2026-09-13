"use client";

import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import * as React from "react";
import { useActionState } from "react";

import { placeOrderAction, type OrderActionState } from "@/lib/actions/orders";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { Badge, Notice } from "@/components/ui/primitives";
import { formatMoney, formatPrice, formatQuantity } from "@/lib/format";
import type { OrderType } from "@/lib/types";
import { cn } from "@/lib/utils";

type Side = "buy" | "sell";

/**
 * The order ticket.
 *
 * The price shown here is informational only — it comes from the same cached
 * quote the server will use, but the server re-fetches it and the database
 * re-checks cash, ownership and every classroom rule. Nothing typed into this
 * form is trusted.
 */
export function TradePanel({
  classroomId,
  symbol,
  displaySymbol,
  assetType,
  price,
  priceStale,
  cashBalance,
  holdingQuantity,
  permitted,
  tradingEnabled,
  pausedReason,
  allowFractional,
  maxTradeValue,
  maxPositionPercent,
  allowedOrderTypes = ["market"],
  marketOpen = true,
}: {
  classroomId: string;
  symbol: string;
  displaySymbol: string;
  assetType: "stock" | "crypto";
  price: number | null;
  priceStale: boolean;
  cashBalance: number;
  holdingQuantity: number;
  permitted: boolean;
  tradingEnabled: boolean;
  pausedReason: string | null;
  allowFractional: boolean;
  maxTradeValue: number | null;
  maxPositionPercent: number | null;
  allowedOrderTypes?: OrderType[];
  marketOpen?: boolean;
}) {
  const [state, formAction, isPending] = useActionState<OrderActionState, FormData>(
    placeOrderAction,
    null,
  );
  const [side, setSide] = React.useState<Side>("buy");
  const [orderType, setOrderType] = React.useState<OrderType>(
    allowedOrderTypes.includes("market") ? "market" : allowedOrderTypes[0] ?? "market",
  );
  const [limitPrice, setLimitPrice] = React.useState("");
  const [stopPrice, setStopPrice] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [idempotencyKey, setIdempotencyKey] = React.useState(() =>
    crypto.randomUUID(),
  );

  // Clear the ticket after a completed order and mint a fresh idempotency key.
  //
  // This is the "adjust state when a value changes" pattern rather than an
  // effect: an effect would cause a second render pass for something React can
  // settle during render. Retrying a *failed* submission deliberately keeps the
  // same key, which is what stops a slow network turning one order into two.
  const [settledState, setSettledState] = React.useState(state);
  if (state !== settledState) {
    setSettledState(state);
    if (state?.ok && state.status !== "pending") {
      setIdempotencyKey(crypto.randomUUID());
      setQuantity("");
      setLimitPrice("");
      setStopPrice("");
    }
  }

  const disabled =
    !tradingEnabled || !permitted || price === null || priceStale ||
    (assetType === "stock" && !marketOpen && orderType === "market");

  const parsedQuantity = Number(quantity);
  const quantityValid =
    quantity.trim() !== "" &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    (!allowFractional && assetType === "stock"
      ? Number.isInteger(parsedQuantity)
      : true);

  const estimated = quantityValid && price !== null ? parsedQuantity * price : 0;

  const maxBuyQuantity =
    price && price > 0 ? Math.floor((cashBalance / price) * 10000) / 10000 : 0;
  const cappedSellQuantity = holdingQuantity;

  function applyFraction(fraction: number) {
    const base = side === "buy" ? maxBuyQuantity : cappedSellQuantity;
    if (base <= 0) return;
    const raw = base * fraction;
    const value = assetType === "crypto" ? Math.floor(raw * 1e6) / 1e6 : raw;
    const trimmed =
      assetType === "crypto"
        ? Number(value.toFixed(6))
        : Number(value.toFixed(6));
    setQuantity(trimmed > 0 ? String(trimmed) : "");
  }

  const localWarnings: string[] = [];
  if (quantityValid && side === "buy" && estimated > cashBalance) {
    localWarnings.push("This is more than your available cash.");
  }
  if (quantityValid && side === "sell" && parsedQuantity > holdingQuantity) {
    localWarnings.push("You don't own enough shares to sell this amount.");
  }
  if (
    quantityValid &&
    maxTradeValue !== null &&
    estimated > maxTradeValue
  ) {
    localWarnings.push(
      `Your teacher has limited a single order to ${formatMoney(maxTradeValue)}.`,
    );
  }
  if (quantityValid && maxPositionPercent !== null && side === "buy") {
    const portfolioValue = cashBalance + holdingQuantity * (price ?? 0);
    const projected = holdingQuantity * (price ?? 0) + estimated;
    if (portfolioValue > 0 && (projected / portfolioValue) * 100 > maxPositionPercent) {
      localWarnings.push(
        `This would put more than ${maxPositionPercent}% of your portfolio into ${displaySymbol}.`,
      );
    }
  }

  return (
    <div className="space-y-4">
      {!tradingEnabled ? (
        <Notice tone="warn">
          {pausedReason?.trim() || "Trading is currently paused by your teacher."}
        </Notice>
      ) : null}

      {!permitted ? (
        <Notice tone="warn">
          Your teacher has not enabled {displaySymbol} for this class, so it cannot
          be traded.
        </Notice>
      ) : null}

      {priceStale ? (
        <Notice tone="warn">
          No live price is available for {displaySymbol} right now, so trading is
          disabled. This is not a zero price — it is an absent one.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-1 rounded-md border border-hairline bg-surface-2 p-1">
        {(["buy", "sell"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={side === option}
            onClick={() => setSide(option)}
            className={cn(
              "h-8 rounded-[6px] text-[13px] font-medium capitalize transition-colors",
              side === option
                ? option === "buy"
                  ? "bg-pos/15 text-pos"
                  : "bg-neg/15 text-neg"
                : "text-ink-subtle hover:text-ink",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="classroomId" value={classroomId} />
        <input type="hidden" name="symbol" value={symbol} />
        <input type="hidden" name="side" value={side} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        {allowedOrderTypes.length > 1 ? (
          <FieldGroup label="Order type" htmlFor="orderType">
            <select
              id="orderType"
              name="orderType"
              value={orderType}
              disabled={disabled || isPending}
              onChange={(event) => setOrderType(event.target.value as OrderType)}
              className="h-9 w-full rounded-md border border-hairline bg-surface-2 px-2 text-[13px] text-ink"
            >
              {(
                [
                  ["market", "Market — fill now"],
                  ["limit", "Limit — at my price or better"],
                  ["stop", "Stop — market once stop hits"],
                  ["stop_limit", "Stop-limit — stop activates a limit"],
                ] as const
              )
                .filter(([value]) => allowedOrderTypes.includes(value))
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </FieldGroup>
        ) : (
          <input type="hidden" name="orderType" value={allowedOrderTypes[0] ?? "market"} />
        )}

        {orderType === "limit" || orderType === "stop_limit" ? (
          <FieldGroup
            label="Limit price"
            htmlFor="limitPrice"
            hint="Highest price you will pay, or lowest you will accept."
          >
            <Input
              id="limitPrice"
              name="limitPrice"
              inputMode="decimal"
              autoComplete="off"
              placeholder={price !== null ? formatPrice(price, assetType) : "0.00"}
              value={limitPrice}
              disabled={disabled || isPending}
              onChange={(event) => setLimitPrice(event.target.value)}
              className="h-9 num"
            />
          </FieldGroup>
        ) : null}

        {orderType === "stop" || orderType === "stop_limit" ? (
          <FieldGroup
            label="Stop price"
            htmlFor="stopPrice"
            hint="The trigger price that activates this order."
          >
            <Input
              id="stopPrice"
              name="stopPrice"
              inputMode="decimal"
              autoComplete="off"
              placeholder={price !== null ? formatPrice(price, assetType) : "0.00"}
              value={stopPrice}
              disabled={disabled || isPending}
              onChange={(event) => setStopPrice(event.target.value)}
              className="h-9 num"
            />
          </FieldGroup>
        ) : null}

        <FieldGroup
          label="Quantity"
          htmlFor="trade-quantity"
          hint={
            side === "sell"
              ? `You hold ${formatQuantity(holdingQuantity, assetType)} ${displaySymbol}.`
              : assetType === "stock" && !allowFractional
                ? "Whole shares only in this class."
                : undefined
          }
        >
          <Input
            id="trade-quantity"
            name="quantity"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={quantity}
            disabled={disabled || isPending}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-9 num text-[15px]"
          />
        </FieldGroup>

        <div className="flex gap-1.5">
          {[0.25, 0.5, 1].map((fraction) => (
            <Button
              key={fraction}
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || isPending}
              onClick={() => applyFraction(fraction)}
              className="flex-1 border border-hairline"
            >
              {fraction === 1 ? "Max" : `${fraction * 100}%`}
            </Button>
          ))}
        </div>

        <dl className="space-y-1.5 rounded-md border border-hairline bg-surface-2 p-3 text-[12px]">
          <div className="flex items-center justify-between">
            <dt className="text-ink-tertiary">Market price</dt>
            <dd className="num text-ink-muted">
              {price === null ? "unavailable" : formatPrice(price, assetType)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink-tertiary">
              Estimated {side === "buy" ? "cost" : "credit"}
            </dt>
            <dd className="num font-medium text-ink">
              {quantityValid ? formatMoney(estimated) : "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink-tertiary">Available cash</dt>
            <dd className="num text-ink-muted">{formatMoney(cashBalance)}</dd>
          </div>
        </dl>

        {localWarnings.length > 0 ? (
          <ul className="space-y-1">
            {localWarnings.map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-1.5 text-[12px] leading-snug text-warn"
              >
                <CircleAlert className="mt-[1px] size-3.5 shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        <Button
          type="submit"
          size="lg"
          variant={side === "buy" ? "primary" : "danger"}
          disabled={disabled || isPending || !quantityValid}
          className="w-full"
        >
          {isPending ? (
            <>
              <LoaderCircle className="animate-spin" />
              Placing…
            </>
          ) : orderType === "market" ? (
            `${side === "buy" ? "Buy" : "Sell"} ${displaySymbol}`
          ) : (
            `Place ${orderType.replace("_", "-")} order`
          )}
        </Button>
      </form>

      {state ? (
        state.ok ? (
          <div className="flex items-start gap-2 rounded-md border border-pos/35 bg-pos/8 px-3 py-2">
            <CircleCheck className="mt-[1px] size-3.5 shrink-0 text-pos" />
            <p className="text-[12px] leading-relaxed text-pos">{state.message}</p>
          </div>
        ) : (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-neg/35 bg-neg/8 px-3 py-2"
          >
            <CircleAlert className="mt-[1px] size-3.5 shrink-0 text-neg" />
            <p className="text-[12px] leading-relaxed text-neg">{state.message}</p>
          </div>
        )
      ) : null}

      <p className="text-[11px] leading-relaxed text-ink-tertiary">
        Simulated order. No real shares, crypto or money change hands.
        {maxPositionPercent !== null ? (
          <>
            {" "}
            <Badge tone="outline" className="px-1.5 py-0 text-[10px]">
              Max {maxPositionPercent}% per asset
            </Badge>
          </>
        ) : null}
      </p>
    </div>
  );
}
