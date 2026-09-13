"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { signInAction } from "@/lib/actions/auth";
import type { FormState } from "@/lib/actions/form-state";

/**
 * One form for both roles. A teacher types their email; a student types the
 * username their teacher gave them. The server decides which is which and
 * resolves a username to its internal account before talking to the auth service.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    signInAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <FieldGroup
        label="Email or username"
        htmlFor="identifier"
        hint="Teachers use their email. Students use the username their teacher gave them, e.g. ada.lovelace"
      >
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="you@school.edu"
          className="h-9"
        />
      </FieldGroup>

      <FieldGroup label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
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

      <Button type="submit" size="lg" variant="primary" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <LoaderCircle className="animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>

      <p className="text-[11px] leading-relaxed text-ink-tertiary">
        Forgotten your password? Students should ask their teacher, who can issue
        a new one from the class roster.
      </p>
    </form>
  );
}
