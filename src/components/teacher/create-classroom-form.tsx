"use client";

import { CircleAlert, LoaderCircle, Plus } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { Panel } from "@/components/ui/primitives";
import { createClassroomAction } from "@/lib/actions/classroom";
import type { FormState } from "@/lib/actions/form-state";

export function CreateClassroomForm({ compact = false }: { compact?: boolean }) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    createClassroomAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <FieldGroup label="Classroom name" htmlFor="name">
        <Input id="name" name="name" required placeholder="Economics" className="h-9" />
      </FieldGroup>

      <div className="grid grid-cols-2 gap-3">
        <FieldGroup label="Period (optional)" htmlFor="section">
          <Input id="section" name="section" placeholder="Period 3" className="h-9" />
        </FieldGroup>
        <FieldGroup label="Starting capital" htmlFor="startingCapital">
          <Input
            id="startingCapital"
            name="startingCapital"
            type="number"
            min={0}
            step="100"
            defaultValue={0}
            className="h-9 num"
          />
        </FieldGroup>
      </div>

      {state && !state.ok && state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-neg/35 bg-neg/8 px-3 py-2"
        >
          <CircleAlert className="mt-[1px] size-3.5 shrink-0 text-neg" />
          <p className="text-[12px] leading-relaxed text-neg">{state.message}</p>
        </div>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size={compact ? "md" : "lg"}
        disabled={isPending}
        className={compact ? undefined : "w-full"}
      >
        {isPending ? (
          <>
            <LoaderCircle className="animate-spin" />
            Creating…
          </>
        ) : (
          <>
            <Plus />
            Create classroom
          </>
        )}
      </Button>
    </form>
  );
}

/** Shown when a teacher account has no classroom yet. */
export function CreateClassroomOnboarding({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-headline font-medium text-ink">
        Welcome{name ? `, ${name}` : ""}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-subtle">
        Create your first classroom to get started. You can add students, set
        their starting capital and control the simulation from the dashboard.
      </p>
      <Panel className="mt-6 p-5">
        <CreateClassroomForm />
      </Panel>
    </div>
  );
}
