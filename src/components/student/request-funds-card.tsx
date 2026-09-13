"use client";

import { Banknote, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Textarea } from "@/components/ui/field";
import { Notice, Panel, PanelHeader } from "@/components/ui/primitives";
import { requestFundsAction } from "@/lib/actions/funds";
import type { FormState } from "@/lib/actions/form-state";
import { formatMoney } from "@/lib/format";
import type { FundRequest } from "@/lib/types";

/**
 * The student's side of the class bank: ask the teacher for more capital, with
 * a reason. One open request at a time is enforced by a partial unique index in
 * the database, so the form stays simple — submit, then wait for a decision.
 */
export function RequestFundsCard({
  classroomId,
  cashBalance,
  requests,
}: {
  classroomId: string;
  cashBalance: number;
  requests: FundRequest[];
}) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    requestFundsAction,
    null,
  );

  const pending = requests.find((request) => request.status === "pending");
  const recent = requests.filter((request) => request.status !== "pending").slice(0, 3);

  return (
    <Panel>
      <PanelHeader
        title="Class bank"
        description="Request more capital. Your teacher approves or denies it."
      />
      <div className="space-y-4 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-ink-tertiary">Your cash</span>
          <span className="num text-[15px] font-medium text-ink">
            {formatMoney(cashBalance)}
          </span>
        </div>

        {pending ? (
          <Notice>
            <span className="flex items-start gap-2">
              <Banknote className="mt-[1px] size-3.5 shrink-0" />
              <span>
                Request for <strong className="num">{formatMoney(pending.amount)}</strong>{" "}
                waiting for your teacher.
              </span>
            </span>
          </Notice>
        ) : (
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="classroomId" value={classroomId} />

            <FieldGroup
              label="Amount (virtual dollars)"
              htmlFor="fundAmount"
              hint="How much you want to withdraw from the class bank."
            >
              <Input
                id="fundAmount"
                name="amount"
                type="number"
                min={0.01}
                step="0.01"
                required
                autoFocus
                placeholder="2500"
                className="h-9 num"
              />
            </FieldGroup>

            <FieldGroup
              label="Reason (optional)"
              htmlFor="fundReason"
              hint="What you plan to do with it."
            >
              <Textarea
                id="fundReason"
                name="reason"
                rows={2}
                maxLength={200}
                placeholder="Diversifying out of cash into an ETF"
                className="text-[12px]"
              />
            </FieldGroup>

            {state && !state.ok && state.message ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-neg/35 bg-neg/8 px-3 py-2"
              >
                <CircleAlert className="mt-[1px] size-3.5 shrink-0 text-neg" />
                <p className="text-[12px] leading-relaxed text-neg">{state.message}</p>
              </div>
            ) : null}

            {state?.ok ? (
              <div
                role="status"
                className="flex items-start gap-2 rounded-md border border-pos/35 bg-pos/8 px-3 py-2"
              >
                <CircleCheck className="mt-[1px] size-3.5 shrink-0 text-pos" />
                <p className="text-[12px] leading-relaxed text-pos">{state.message}</p>
              </div>
            ) : null}

            <Button type="submit" variant="primary" size="md" disabled={isPending}>
              {isPending ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Banknote />
                  Request funds
                </>
              )}
            </Button>
          </form>
        )}

        {recent.length > 0 ? (
          <div className="space-y-1.5 border-t border-hairline pt-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">
              Recent requests
            </p>
            {recent.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between text-[12px]"
              >
                <span className="num text-ink-muted">{formatMoney(request.amount)}</span>
                <span
                  className={
                    request.status === "approved"
                      ? "text-pos"
                      : "text-ink-tertiary line-through"
                  }
                >
                  {request.status === "approved" ? "Approved" : "Denied"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}