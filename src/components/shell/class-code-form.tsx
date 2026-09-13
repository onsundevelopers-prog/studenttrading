"use client";

import { ChevronDown, CircleAlert, LoaderCircle, Users } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { joinClassByCodeAction } from "@/lib/actions/auth";
import type { FormState } from "@/lib/actions/form-state";

/**
 * Self-serve student entry: the class code a teacher hands out is enough to
 * join. Collapsed by default so the sign-in form stays the primary action;
 * expands into a short signup form — name, handle, password — and enrols the
 * student at the class's default capital, which is zero unless the teacher set
 * one. Nothing is invented here: the code decides the class, the class decides
 * the money.
 */
export function ClassCodeForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    joinClassByCodeAction,
    null,
  );

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="class-code-form"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-surface-2 px-4 py-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink"
      >
        <Users className="size-4" />
        Enter class code
        <ChevronDown
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <form
          id="class-code-form"
          action={formAction}
          className="space-y-4 rounded-lg border border-hairline bg-surface-2 p-4"
        >
          <FieldGroup
            label="Class code"
            htmlFor="classCode"
            hint="Your teacher gives you this — e.g. AB12CD"
          >
            <Input
              id="classCode"
              name="classCode"
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="AB12CD"
              maxLength={10}
              className="h-9 font-mono uppercase tracking-wide"
            />
          </FieldGroup>

          <FieldGroup label="Your name" htmlFor="joinFullName">
            <Input
              id="joinFullName"
              name="fullName"
              required
              autoComplete="name"
              placeholder="Ada Lovelace"
              className="h-9"
            />
          </FieldGroup>

          <FieldGroup
            label="Choose a handle"
            htmlFor="joinHandle"
            hint="You will sign in with this. 2–32 characters: letters, numbers, dot, dash or underscore."
          >
            <Input
              id="joinHandle"
              name="handle"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ada.lovelace"
              className="h-9"
            />
          </FieldGroup>

          <FieldGroup
            label="Choose a password"
            htmlFor="joinPassword"
            hint="At least 8 characters."
          >
            <Input
              id="joinPassword"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="h-9"
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

          {state && state.ok && state.message ? (
            <div
              role="status"
              className="rounded-md border border-pos/35 bg-pos/8 px-3 py-2 text-[12px] leading-relaxed text-pos"
            >
              {state.message}
            </div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            variant="primary"
            className="w-full"
            disabled={isPending}
          >
            {isPending ? (
              <>
                <LoaderCircle className="animate-spin" />
                Joining…
              </>
            ) : (
              "Join the class"
            )}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
