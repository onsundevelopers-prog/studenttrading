"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import { signUpTeacherAction } from "@/lib/actions/auth";
import type { FormState } from "@/lib/actions/form-state";

export function SignupForm() {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    signUpTeacherAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <FieldGroup label="Your name" htmlFor="fullName">
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          placeholder="Ms. Rivera"
          className="h-9"
        />
      </FieldGroup>

      <FieldGroup label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          placeholder="you@school.edu"
          className="h-9"
        />
      </FieldGroup>

      <FieldGroup
        label="Password"
        htmlFor="password"
        hint="At least 8 characters."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="h-9"
        />
      </FieldGroup>

      <div className="grid grid-cols-2 gap-3">
        <FieldGroup label="Classroom name" htmlFor="classroomName">
          <Input
            id="classroomName"
            name="classroomName"
            required
            placeholder="Economics"
            className="h-9"
          />
        </FieldGroup>
        <FieldGroup label="Period (optional)" htmlFor="section">
          <Input
            id="section"
            name="section"
            placeholder="Period 3"
            className="h-9"
          />
        </FieldGroup>
      </div>

      <FieldGroup
        label="Starting capital per student"
        htmlFor="startingCapital"
        hint="Virtual dollars, assigned when students are added. Leave 0 and grant funds per student instead."
      >
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

      <FieldGroup
        label="Invite code"
        htmlFor="inviteCode"
        hint="Creating a teacher account needs an invite code from the site administrator."
      >
        <Input
          id="inviteCode"
          name="inviteCode"
          required
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="TEACHER-2026"
          className="h-9 font-mono uppercase"
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
            Creating your classroom…
          </>
        ) : (
          "Create classroom"
        )}
      </Button>
    </form>
  );
}
