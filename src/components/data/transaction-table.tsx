import { Receipt } from "lucide-react";

import { AssetMark, SideBadge } from "@/components/data/atoms";
import {
  DataTable,
  EmptyState,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import {
  formatDateTime,
  formatMoney,
  formatPrice,
  formatQuantity,
  formatSignedMoney,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TradeRecord } from "@/lib/types";

export function TransactionTable({
  trades,
  showStudent = false,
  emptyTitle = "No trades yet.",
  emptyDescription = "Every buy and sell you make will appear here.",
  className,
}: {
  trades: TradeRecord[];
  showStudent?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<Receipt className="size-5" />}
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    );
  }

  return (
    <DataTable className={className}>
      <thead>
        <tr>
          <Th className="pl-4">Time</Th>
          {showStudent ? <Th>Student</Th> : null}
          <Th>Side</Th>
          <Th>Asset</Th>
          <Th align="right">Quantity</Th>
          <Th align="right">Price</Th>
          <Th align="right">Value</Th>
          <Th align="right" className="pr-4">
            Realised P/L
          </Th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => (
          <Tr key={trade.id}>
            <Td className="num whitespace-nowrap pl-4 text-ink-subtle">
              {formatDateTime(trade.createdAt)}
            </Td>
            {showStudent ? (
              <Td className="max-w-[160px] truncate text-ink-muted">
                {trade.studentLabel}
              </Td>
            ) : null}
            <Td>
              <SideBadge side={trade.side} />
            </Td>
            <Td>
              <span className="flex min-w-0 items-center gap-2">
                <AssetMark
                  symbol={trade.displaySymbol}
                  assetType={trade.assetType}
                />
                <span className="min-w-0">
                  <span className="block max-w-[180px] truncate text-[13px] text-ink-muted">
                    {trade.name}
                  </span>
                  <span className="block font-mono text-[11px] text-ink-tertiary">
                    {trade.symbol}
                  </span>
                </span>
              </span>
            </Td>
            <Td align="right" className="text-ink-muted">
              {formatQuantity(trade.quantity, trade.assetType)}
            </Td>
            <Td align="right" className="text-ink-muted">
              {formatPrice(trade.price, trade.assetType)}
            </Td>
            <Td align="right" className="font-medium text-ink">
              {formatMoney(trade.totalValue)}
            </Td>
            <Td align="right" className="pr-4">
              {trade.realizedPnl === null ? (
                <span className="text-ink-tertiary" title="Buys do not realise a gain or loss.">
                  —
                </span>
              ) : (
                <span
                  className={cn(
                    "num",
                    trade.realizedPnl > 0
                      ? "text-pos"
                      : trade.realizedPnl < 0
                        ? "text-neg"
                        : "text-ink-subtle",
                  )}
                >
                  {formatSignedMoney(trade.realizedPnl)}
                </span>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}
