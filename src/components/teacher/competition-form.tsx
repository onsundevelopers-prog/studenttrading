"use client";

import { CircleAlert, LoaderCircle, Trophy } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Textarea } from "@/components/ui/field";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { createCompetitionAction } from "@/lib/actions/classroom";
import type { FormState } from "@/lib/actions/form-state";

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * A competition is a window, not a separate portfolio: every active student is
 * baselined at their value when it is created, and the standings are the change
 * since then.
 */
export function CompetitionForm({ classroomId }: { classroomId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createCompetitionAction,
    null,
  );

  const now = new Date();
  const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  return (
    <Panel>
      <PanelHeader
        title="New competition"
        description="Everyone currently enrolled is baselined at their portfolio value right now, and ranked on the change since."
      />
      <form action={formAction}>
        <PanelBody className="space-y-4">
          <input type="hidden" name="classroomId" value={classroomId} />

          <FieldGroup label="Name" htmlFor="competitionName">
            <Input
              id="competitionName"
              name="name"
              required
              placeholder="Week 1 Sprint"
              className="h-9"
            />
          </FieldGroup>

          <FieldGroup label="Description (optional)" htmlFor="competitionDescription">
            <Textarea
              id="competitionDescription"
              name="description"
              rows={2}
              placeholder="Diversification week — best risk-adjusted return."
            />
          </FieldGroup>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Starts" htmlFor="startsAt">
              <Input
                id="startsAt"
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={toLocalInputValue(now)}
                className="h-9 num"
              />
            </FieldGroup>
            <FieldGroup label="Ends" htmlFor="endsAt">
              <Input
                id="endsAt"
                name="endsAt"
                type="datetime-local"
                required
                defaultValue={toLocalInputValue(inAWeek)}
                className="h-9 num"
              />
            </FieldGroup>
          </div>

          {state?.message ? (
            <div
              role="alert"
              className={
                state.ok
                  ? "rounded-md border border-pos/35 bg-pos/8 px-3 py-2 text-[12px] leading-relaxed text-pos"
                  : "flex items-start gap-2 rounded-md border border-neg/35 bg-neg/8 px-3 py-2"
              }
            >
              {!state.ok ? (
                <CircleAlert className="mt-[1px] size-3.5 shrink-0 text-neg" />
              ) : null}
              <p className={state.ok ? undefined : "text-[12px] leading-relaxed text-neg"}>
                {state.message}
              </p>
            </div>
          ) : null}

          <Button type="submit" variant="primary" size="md" disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className="animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Trophy />
                Create competition
              </>
            )}
          </Button>
        </PanelBody>
      </form>
    </Panel>
  );
}
