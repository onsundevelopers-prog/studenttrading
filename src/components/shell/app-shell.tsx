import type * as React from "react";

import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";
import {
  ClassroomSwitcher,
  PageTitle,
  UserMenu,
  type ClassroomOption,
} from "./topbar-parts";

/**
 * The application frame: fixed sidebar on desktop, top bar everywhere, fixed tab
 * bar on mobile. Content is capped at a readable width so tables stay dense
 * without stretching to absurd line lengths on a projector.
 */
export function AppShell({
  role,
  classrooms,
  activeClassroomId,
  user,
  priceFreshness,
  children,
}: {
  role: "teacher" | "student";
  classrooms: ClassroomOption[];
  activeClassroomId: string;
  user: { name: string; detail: string; signOut: () => Promise<void> };
  priceFreshness?: React.ReactNode;
  children: React.ReactNode;
}) {
  const active = classrooms.find((classroom) => classroom.id === activeClassroomId);

  return (
    <div className="flex min-h-dvh">
      <Sidebar role={role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-canvas/90 px-3 backdrop-blur-sm sm:px-4">
          <MobileNav
            role={role}
            title={role === "teacher" ? "Teacher navigation" : "Student navigation"}
            subtitle={active ? `${active.name}${active.section ? ` · ${active.section}` : ""}` : undefined}
          />
          <PageTitle role={role} />
          <span className="hidden h-4 w-px bg-hairline sm:block" aria-hidden />
          <ClassroomSwitcher
            role={role}
            classrooms={classrooms}
            activeId={activeClassroomId}
          />
          <div className="ml-auto flex items-center gap-2">
            {priceFreshness}
            <UserMenu
              name={user.name}
              detail={user.detail}
              role={role}
              signOut={user.signOut}
            />
          </div>
        </header>

        <main className="flex-1 px-3 pb-24 pt-4 sm:px-4 lg:pb-10">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
