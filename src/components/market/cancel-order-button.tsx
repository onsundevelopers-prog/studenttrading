"use client";

import { LoaderCircle, X } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { cancelOrderAction, type OrderActionState } from "@/lib/actions/orders";

/** Cancels one of the student's own working orders. Ownership is re-checked
 * server-side by `cancel_order`; this button only sends the id. */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [state, formAction, isPending] = useActionState<OrderActionState, FormData>(
    cancelOrderAction,
    null,
  );

  if (state?.ok) return null; // cancelled — the row disappears on refresh

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={isPending}
        className="text-neg hover:text-neg"
      >
        {isPending ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <>
            <X />
            Cancel
          </>
        )}
      </Button>
    </form>
  );
}
