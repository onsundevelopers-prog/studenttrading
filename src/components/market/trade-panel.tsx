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

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  market: "Market Order",
  limit: "Limit Order",
  stop: "Stop Order",
  stop_limit: "Stop-Limit Order",
};

/**
 * A plain-language explanation of whichever order type is selected.
 *
 * These are standard market terms and are kept rather than replaced, but a
 * student who has never traded should not have to guess what they mean.
 */
const ORDER_TYPE_EXPLANATIONS: Record<OrderType, string> = {
  market:
    "Buy or sell right away at the best price available. The order completes immediately.",
  limit:
    "Set the highest price you are willing to pay when buying, or the lowest price you will accept when selling. The order waits until the market reaches your price.",
  stop:
    "Set a trigger price. Once the market reaches it, your order is sent as a market order and fills at the best price available at that moment.",
  stop_limit:
    "Set a trigger price and a limit price. When the trigger price is reached, a limit order is placed at the limit price you chose.",
};

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
  /**
   * The review step. A signature of the order's terms means any edit drops the
   * ticket straight back to review — a confirmation can never describe an order
   * other than the one on screen, and nothing is submitted without one.
   */
  const orderSignature = `${side}|${orderType}|${quantity}|${limitPrice}|${stopPrice}`;
  const [reviewedSignature, setReviewedSignature] = React.useState<string | null>(
    null,
  );
  const reviewing = reviewedSignature === orderSignature;

  const [settledState, setSettledState] = React.useState(state);
  if (state !== settledState) {
    setSettledState(state);
    if (state?.ok && state.status !== "pending") {
      setIdempotencyKey(crypto.randomUUID());
      setQuantity("");
      setLimitPrice("");
      setStopPrice("");
      setReviewedSignature(null);
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

  // A resting order commits money at its limit price, not at the last trade, so
  // the ticket has to show both figures rather than pretend they are the same.
  const limitValue = Number(limitPrice);
  const limitUsable =
    (orderType === "limit" || orderType === "stop_limit") &&
    limitPrice.trim() !== "" &&
    Number.isFinite(limitValue) &&
    limitValue > 0;

  const stopValue = Number(stopPrice);
  const stopUsable =
    (orderType === "stop" || orderType === "stop_limit") &&
    stopPrice.trim() !== "" &&
    Number.isFinite(stopValue) &&
    stopValue > 0;

  const referencePrice = limitUsable ? limitValue : price;
  const estimatedTotal =
    quantityValid && referencePrice !== null ? parsedQuantity * referencePrice : 0;
  const buyingPowerAfter =
    side === "buy" ? cashBalance - estimatedTotal : cashBalance + estimatedTotal;

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
  if (quantityValid && side === "buy" && estimatedTotal > cashBalance) {
    localWarnings.push("This is more than your available cash.");
  }
  if (quantityValid && side === "sell" && parsedQuantity > holdingQuantity) {
    localWarnings.push("You don't own enough shares to sell this amount.");
  }
  if (
    quantityValid &&
    maxTradeValue !== null &&
    estimatedTotal > maxTradeValue
  ) {
    localWarnings.push(
      `Your teacher has limited a single order to ${formatMoney(maxTradeValue)}.`,
    );
  }
  if (quantityValid && maxPositionPercent !== null && side === "buy") {
    const portfolioValue = cashBalance + holdingQuantity * (price ?? 0);
    const projected = holdingQuantity * (price ?? 0) + estimatedTotal;
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
          No current price is available for {displaySymbol} right now, so trading
          is switched off until one is. The price is unknown, not zero.
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
          <FieldGroup label="Order Type" htmlFor="orderType">
            <select
              id="orderType"
              name="orderType"
              value={orderType}
              disabled={disabled || isPending}
              onChange={(event) => setOrderType(event.target.value as OrderType)}
              className="h-9 w-full rounded-md border border-hairline bg-surface-2 px-2 text-[13px] text-ink"
            >
              {(
                ["market", "limit", "stop", "stop_limit"] as const
              )
                .filter((value) => allowedOrderTypes.includes(value))
                .map((value) => (
                  <option key={value} value={value}>
                    {ORDER_TYPE_LABELS[value]}
                  </option>
                ))}
            </select>
          </FieldGroup>
        ) : (
          <input type="hidden" name="orderType" value={allowedOrderTypes[0] ?? "market"} />
        )}

        <p className="text-[11px] leading-relaxed text-ink-tertiary">
          <span className="text-ink-muted">{ORDER_TYPE_LABELS[orderType]}:</span>{" "}
          {ORDER_TYPE_EXPLANATIONS[orderType]}
        </p>

        {orderType === "limit" || orderType === "stop_limit" ? (
          <FieldGroup
            label="Limit Price"
            htmlFor="limitPrice"
            hint="The highest price you will pay, or the lowest price you will accept."
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
            label="Stop Price"
            htmlFor="stopPrice"
            hint="The price that activates this order once the market reaches it."
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
          label={assetType === "stock" ? "Shares" : "Amount"}
          htmlFor="trade-quantity"
          hint={
            side === "sell"
              ? `You own ${formatQuantity(holdingQuantity, assetType)} ${displaySymbol}.`
              : assetType === "stock" && !allowFractional
                ? "Whole shares only in this class."
                : "How many units of this investment you want to trade."
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
            <dt
              className="text-ink-tertiary"
              title="The latest price for this investment from the market data provider."
            >
              Current Market Price
            </dt>
            <dd className="num text-ink-muted">
              {price === null ? "unavailable" : formatPrice(price, assetType)}
            </dd>
          </div>
          {limitUsable ? (
            <div className="flex items-center justify-between">
              <dt className="text-ink-tertiary">Limit Price</dt>
              <dd className="num text-ink-muted">
                {formatPrice(limitValue, assetType)}
              </dd>
            </div>
          ) : null}
          {stopUsable ? (
            <div className="flex items-center justify-between">
              <dt className="text-ink-tertiary">Stop Price</dt>
              <dd className="num text-ink-muted">
                {formatPrice(stopValue, assetType)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <dt className="text-ink-tertiary">
              Estimated {side === "buy" ? "Cost" : "Money Received"}
            </dt>
            <dd className="num font-medium text-ink">
              {quantityValid ? formatMoney(estimatedTotal) : "—"}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt
              className="text-ink-tertiary"
              title="Money you currently have available to invest."
            >
              Available Cash
            </dt>
            <dd className="num text-ink-muted">{formatMoney(cashBalance)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt
              className="text-ink-tertiary"
              title="How much money you would still have available to invest after this order."
            >
              Money Available to Invest After
            </dt>
            <dd className="num text-ink-muted">
              {quantityValid ? formatMoney(buyingPowerAfter) : "—"}
            </dd>
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

        {reviewing ? (
          <div className="space-y-3 rounded-md border border-hairline-strong bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="eyebrow">Confirm Your Order</h3>
              <Badge tone={side === "buy" ? "pos" : "neg"}>
                {side === "buy" ? "Buy" : "Sell"}
              </Badge>
            </div>

            <dl className="space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between">
                <dt className="text-ink-tertiary">Symbol</dt>
                <dd className="num text-ink">{symbol}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-tertiary">Order Type</dt>
                <dd className="text-right text-ink">{ORDER_TYPE_LABELS[orderType]}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-tertiary">
                  {assetType === "stock" ? "Shares" : "Amount"}
                </dt>
                <dd className="num text-ink">
                  {formatQuantity(parsedQuantity, assetType)} {displaySymbol}
                </dd>
              </div>
              {limitUsable ? (
                <div className="flex items-center justify-between">
                  <dt className="text-ink-tertiary">Limit Price</dt>
                  <dd className="num text-ink">{formatPrice(limitValue, assetType)}</dd>
                </div>
              ) : null}
              {stopUsable ? (
                <div className="flex items-center justify-between">
                  <dt className="text-ink-tertiary">Stop Price</dt>
                  <dd className="num text-ink">{formatPrice(stopValue, assetType)}</dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between border-t border-hairline pt-1.5">
                <dt className="text-ink-tertiary">
                  Estimated {side === "buy" ? "Cost" : "Money Received"}
                </dt>
                <dd className="num font-medium text-ink">{formatMoney(estimatedTotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-tertiary">Money Available to Invest After</dt>
                <dd className="num text-ink-muted">{formatMoney(buyingPowerAfter)}</dd>
              </div>
            </dl>

            <p className="text-[11px] leading-relaxed text-ink-tertiary">
              {orderType === "market"
                ? "This completes at the next available price, which is recorded with the order."
                : "This waits until the market reaches your price. You can cancel it at any time before it completes."}
            </p>

            <div className="flex gap-2">
              <Button
                type="button"
                size="lg"
                variant="secondary"
                className="flex-1"
                disabled={isPending}
                onClick={() => setReviewedSignature(null)}
              >
                Edit
              </Button>
              <Button
                type="submit"
                size="lg"
                variant={side === "buy" ? "primary" : "danger"}
                className="flex-1"
                disabled={disabled || isPending}
              >
                {isPending ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Placing…
                  </>
                ) : (
                  "Place Order"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="lg"
            variant={side === "buy" ? "primary" : "danger"}
            disabled={disabled || isPending || !quantityValid}
            className="w-full"
            onClick={() => setReviewedSignature(orderSignature)}
          >
            Review Order
          </Button>
        )}
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
        Simulated order. No real shares, crypto or money change hands, and this
        never affects a real brokerage account.
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
