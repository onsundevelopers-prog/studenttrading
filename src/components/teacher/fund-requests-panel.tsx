"use client";

import { Banknote, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
} from "@/components/ui/overlays";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { decideFundRequestAction } from "@/lib/actions/funds";
import type { FormState } from "@/lib/actions/form-state";
import { formatMoney, formatRelative } from "@/lib/format";
import * as React from "react";
import type { FundRequest } from "@/lib/types";

/**
 * The teacher's side of the class bank: a queue of pending student requests.
 * Approving grants the cash through `adjust_cash`, so the student's
 * `initial_capital` moves with it and the grant never reads as trading profit.
 */
export function FundRequestsPanel({ requests }: { requests: FundRequest[] }) {
  const [deciding, setDeciding] = React.useState<FundRequest | null>(null);
  const [decision, setDecision] = React.useState<"approved" | "denied">("approved");

  if (requests.length === 0) return null;

  return (
    <>
      <Panel>
        <PanelHeader
          title="Fund requests"
          description="Students asking the class bank for more capital. Approving adds it to their starting capital, not their trading P/L."
        />
        <div className="divide-y divide-hairline">
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">
                  {request.studentName}
                  {request.handle ? (
                    <span className="ml-2 font-mono text-[11px] text-ink-tertiary">
                      {request.handle}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-tertiary">
                  <span className="num">{formatMoney(request.amount)}</span> ·{" "}
                  {formatRelative(request.createdAt)}
                  {request.reason ? ` · ${request.reason}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setDecision("approved");
                    setDeciding(request);
                  }}
                >
                  <CircleCheck />
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-neg hover:text-neg"
                  onClick={() => {
                    setDecision("denied");
                    setDeciding(request);
                  }}
                >
                  <CircleX />
                  Deny
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <DecideDialog
        request={deciding}
        decision={decision}
        onOpenChange={(open) => {
          if (!open) setDeciding(null);
        }}
      />
    </>
  );
}

function DecideDialog({
  request,
  decision,
  onOpenChange,
}: {
  request: FundRequest | null;
  decision: "approved" | "denied";
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    decideFundRequestAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) onOpenChange(false);
  }, [state, onOpenChange]);

  if (!request) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={
            decision === "approved"
              ? `Approve ${formatMoney(request.amount)} for ${request.studentName}?`
              : `Deny ${request.studentName}'s request?`
          }
          description={
            decision === "approved"
              ? "The cash is added to their balance immediately and counts as starting capital, not performance."
              : "The student keeps their current balance and can submit a new request."
          }
        />

        {state && !state.ok && state.message ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-neg/35 bg-neg/8 px-3 py-2"
          >
            <p className="text-[12px] leading-relaxed text-neg">{state.message}</p>
          </div>
        ) : null}

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="decision" value={decision} />

          {decision === "approved" ? (
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-tertiary">
              <Banknote className="mt-[1px] size-3.5 shrink-0" />
              {request.reason ? `Their reason: “${request.reason}”` : "They left no reason."}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="md" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" size="md" disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Working…
                </>
              ) : decision === "approved" ? (
                "Approve and grant"
              ) : (
                "Deny request"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
