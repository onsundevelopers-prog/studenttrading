"use client";

import { CircleAlert, LoaderCircle, UserPlus } from "lucide-react";
import * as React from "react";
import { useActionState } from "react";

import { CredentialsList } from "@/components/teacher/credentials-list";
import { Button } from "@/components/ui/button";
import { FieldGroup, Input, Textarea } from "@/components/ui/field";
import { Notice, Panel, PanelHeader } from "@/components/ui/primitives";
import { addStudentsAction } from "@/lib/actions/classroom";
import type { FormState } from "@/lib/actions/form-state";
import type { ProvisionedStudent } from "@/lib/types";

/**
 * Creates student accounts from a pasted roster.
 *
 * Students have no email addresses in this product, so the server mints an
 * internal account per handle and returns the generated passwords exactly once.
 */
export function AddStudentsForm({
  classroomId,
  defaultStartingCapital,
}: {
  classroomId: string;
  defaultStartingCapital: number;
}) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    addStudentsAction,
    null,
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  const credentials =
    state?.ok && state.data && typeof state.data === "object"
      ? ((state.data as { credentials?: ProvisionedStudent[] }).credentials ?? [])
      : [];

  React.useEffect(() => {
    if (state?.ok && credentials.length > 0) {
      const textarea = formRef.current?.querySelector("textarea");
      if (textarea) textarea.value = "";
    }
  }, [state, credentials.length]);

  return (
    <Panel>
      <PanelHeader
        title="Add students"
        description="One student per line: Name, or Name, handle, or Name, handle, student ID. Tabs work too."
      />
      <div className="space-y-4 p-4">
        <form ref={formRef} action={formAction} className="space-y-3">
          <input type="hidden" name="classroomId" value={classroomId} />

          <FieldGroup
            label="Class roster"
            htmlFor="roster"
            hint="Handles are generated from names if you leave them out. Duplicate handles are skipped."
          >
            <Textarea
              id="roster"
              name="roster"
              required
              rows={6}
              spellCheck={false}
              placeholder={"Ada Lovelace\nGrace Hopper, grace\nAlan Turing, alan.turing, 1023847"}
              className="font-mono text-[12px]"
            />
          </FieldGroup>

          <FieldGroup
            label="Starting capital for these students"
            htmlFor="startingCapital"
            hint={`Class default is $${defaultStartingCapital.toLocaleString("en-US")}.`}
          >
            <Input
              id="startingCapital"
              name="startingCapital"
              type="number"
              min={0}
              step="100"
              defaultValue={defaultStartingCapital}
              className="h-9 num"
            />
          </FieldGroup>

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

          <Button type="submit" variant="primary" size="md" disabled={isPending}>
            {isPending ? (
              <>
                <LoaderCircle className="animate-spin" />
                Creating accounts…
              </>
            ) : (
              <>
                <UserPlus />
                Create student accounts
              </>
            )}
          </Button>
        </form>

        {credentials.length > 0 ? (
          <div className="border-t border-hairline pt-4">
            <CredentialsList students={credentials} />
          </div>
        ) : (
          <Notice>
            Each new student signs in with the handle you assign and the password
            shown here. Student IDs are used for display only — they are never
            sufficient on their own to sign in.
          </Notice>
        )}
      </div>
    </Panel>
  );
}
