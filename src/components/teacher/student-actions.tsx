"use client";

import { CircleAlert, KeyRound, LoaderCircle, MoreHorizontal, RotateCcw, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useActionState } from "react";

import { CredentialsList } from "@/components/teacher/credentials-list";
import { Button } from "@/components/ui/button";
import { FieldGroup, Input } from "@/components/ui/field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { Notice } from "@/components/ui/primitives";
import {
  adjustCashAction,
  resetStudentAction,
  resetStudentPasswordAction,
} from "@/lib/actions/classroom";
import type { FormState } from "@/lib/actions/form-state";
import type { ProvisionedStudent } from "@/lib/types";

/**
 * Row-level teacher controls for one student.
 *
 * Each dialog posts to a server action that re-checks that the caller teaches
 * this classroom before touching any money or credentials.
 */
export function StudentActions({
  classroomId,
  studentId,
  studentName,
  defaultStartingCapital,
}: {
  classroomId: string;
  studentId: string;
  studentName: string;
  defaultStartingCapital: number;
}) {
  const [openDialog, setOpenDialog] = React.useState<null | "cash" | "reset" | "password">(
    null,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${studentName}`}
          className="grid size-7 place-items-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href={`/teacher/students/${studentId}`}>View portfolio</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpenDialog("cash")}>
            <Wallet className="size-3.5" />
            Adjust available cash
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpenDialog("password")}>
            <KeyRound className="size-3.5" />
            Issue new password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setOpenDialog("reset")}
            className="text-neg focus:text-neg"
          >
            <RotateCcw className="size-3.5" />
            Reset portfolio
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AdjustCashDialog
        open={openDialog === "cash"}
        onOpenChange={(open) => setOpenDialog(open ? "cash" : null)}
        classroomId={classroomId}
        studentId={studentId}
        studentName={studentName}
      />

      <ResetPortfolioDialog
        open={openDialog === "reset"}
        onOpenChange={(open) => setOpenDialog(open ? "reset" : null)}
        classroomId={classroomId}
        studentId={studentId}
        studentName={studentName}
        defaultStartingCapital={defaultStartingCapital}
      />

      <PasswordDialog
        open={openDialog === "password"}
        onOpenChange={(open) => setOpenDialog(open ? "password" : null)}
        classroomId={classroomId}
        studentId={studentId}
        studentName={studentName}
      />
    </>
  );
}

function SubmitRow({ pending, label }: { pending: boolean; label: string }) {
  return (
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
        ) : (
          label
        )}
      </Button>
    </div>
  );
}

function ErrorLine({ state }: { state: FormState }) {
  if (!state || state.ok || !state.message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-neg/35 bg-neg/8 px-3 py-2"
    >
      <CircleAlert className="mt-[1px] size-3.5 shrink-0 text-neg" />
      <p className="text-[12px] leading-relaxed text-neg">{state.message}</p>
    </div>
  );
}

function AdjustCashDialog({
  open,
  onOpenChange,
  classroomId,
  studentId,
  studentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroomId: string;
  studentId: string;
  studentName: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    adjustCashAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Adjust ${studentName}'s available cash`}
          description="Use a negative amount to take virtual money away. The adjustment also moves the money this student started with, so it never counts as trading profit or loss."
        />
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="classroomId" value={classroomId} />
          <input type="hidden" name="studentId" value={studentId} />
          <FieldGroup
            label="Amount (virtual dollars)"
            htmlFor="delta"
            hint="e.g. 2500 to add, -500 to remove."
          >
            <Input
              id="delta"
              name="delta"
              type="number"
              step="0.01"
              required
              autoFocus
              placeholder="2500"
              className="h-9 num"
            />
          </FieldGroup>
          <FieldGroup label="Reason (optional)" htmlFor="reason">
            <Input
              id="reason"
              name="reason"
              placeholder="Best research write-up"
              className="h-9"
            />
          </FieldGroup>
          <ErrorLine state={state} />
          <SubmitRow pending={pending} label="Apply adjustment" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPortfolioDialog({
  open,
  onOpenChange,
  classroomId,
  studentId,
  studentName,
  defaultStartingCapital,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroomId: string;
  studentId: string;
  studentName: string;
  defaultStartingCapital: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    resetStudentAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Reset ${studentName}'s portfolio`}
          description="This clears every investment and the full trade history for this student in this classroom. It cannot be undone."
        />
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="classroomId" value={classroomId} />
          <input type="hidden" name="studentId" value={studentId} />
          <FieldGroup
            label="Starting capital"
            htmlFor="startingCapital"
            hint="Leave as-is to restore the class default."
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
          <ErrorLine state={state} />
          <SubmitRow pending={pending} label="Reset portfolio" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  open,
  onOpenChange,
  classroomId,
  studentId,
  studentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroomId: string;
  studentId: string;
  studentName: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    resetStudentPasswordAction,
    null,
  );

  const credentials =
    state?.ok && Array.isArray(state.data)
      ? (state.data as ProvisionedStudent[])
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={`New password for ${studentName}`}
          description="The old password stops working straight away. The student keeps their investments and trade history."
        />

        {credentials.length > 0 ? (
          <div className="space-y-4">
            <CredentialsList
              students={credentials}
              title="New password"
              warning="Shown once. Copy it before closing this dialog."
            />
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="secondary" size="md">
                  Done
                </Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="classroomId" value={classroomId} />
            <input type="hidden" name="studentId" value={studentId} />
            <Notice>
              A new random password will be generated. You will see it once.
            </Notice>
            <ErrorLine state={state} />
            <SubmitRow pending={pending} label="Generate password" />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
