"use client";

import { ChevronDown, LogOut, School } from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";

import { selectClassroomAction } from "@/lib/actions/classroom";
import { selectStudentClassroomAction } from "@/lib/actions/watchlist";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { labelForPath, navFor } from "./nav-config";

export type ClassroomOption = {
  id: string;
  name: string;
  section: string | null;
  joinCode: string;
};

export function PageTitle({ role }: { role: "teacher" | "student" }) {
  const pathname = usePathname();
  const label = React.useMemo(
    () => labelForPath(navFor(role), pathname),
    [pathname, role],
  );
  return (
    <h1 className="truncate text-[13px] font-medium text-ink">{label}</h1>
  );
}

/**
 * Switching classrooms writes a preference cookie through a server action, which
 * re-validates that the user actually owns or belongs to the target classroom
 * before accepting it.
 */
export function ClassroomSwitcher({
  role,
  classrooms,
  activeId,
}: {
  role: "teacher" | "student";
  classrooms: ClassroomOption[];
  activeId: string;
}) {
  const [pending, startTransition] = React.useTransition();
  const active = classrooms.find((classroom) => classroom.id === activeId);

  if (classrooms.length === 0) return null;

  if (classrooms.length === 1) {
    return (
      <div className="hidden items-center gap-1.5 text-[12px] text-ink-subtle sm:flex">
        <School className="size-3.5 text-ink-tertiary" />
        <span className="max-w-[220px] truncate text-ink-muted">
          {active?.name ?? "Classroom"}
        </span>
        {active?.section ? (
          <span className="text-ink-tertiary">· {active.section}</span>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={role === "teacher" ? selectClassroomAction : selectStudentClassroomAction}
      className="relative hidden sm:block"
    >
      <select
        key={activeId}
        name="classroomId"
        defaultValue={activeId}
        aria-label="Active classroom"
        disabled={pending}
        onChange={(event) => {
          const form = event.currentTarget.form;
          startTransition(() => form?.requestSubmit());
        }}
        className={cn(
          "h-7 max-w-[260px] cursor-pointer appearance-none truncate rounded-md border border-hairline bg-surface-2 pl-2.5 pr-7 text-[12px] text-ink-muted outline-none transition-colors hover:border-hairline-strong hover:text-ink",
          pending && "opacity-60",
        )}
      >
        {classrooms.map((classroom) => (
          <option key={classroom.id} value={classroom.id}>
            {classroom.name}
            {classroom.section ? ` · ${classroom.section}` : ""}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-tertiary"
      />
    </form>
  );
}

export function UserMenu({
  name,
  detail,
  role,
  signOut,
}: {
  name: string;
  detail: string;
  role: "teacher" | "student";
  signOut: () => Promise<void>;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-md border border-hairline bg-surface-2 py-1 pl-1 pr-2 text-[12px] text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink"
      >
        <span
          aria-hidden
          className="grid size-5 place-items-center rounded-[5px] bg-surface-4 text-[10px] font-medium text-ink-muted"
        >
          {initials || "?"}
        </span>
        <span className="hidden max-w-[140px] truncate sm:inline">{name}</span>
        <ChevronDown className="size-3.5 text-ink-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          {role === "teacher" ? "Teacher account" : "Student account"}
        </DropdownMenuLabel>
        <div className="px-2.5 pb-2">
          <p className="truncate text-[13px] text-ink">{name}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-tertiary">
            {detail}
          </p>
        </div>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full cursor-pointer">
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
