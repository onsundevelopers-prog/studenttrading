import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { PriceFreshness } from "@/components/shell/price-freshness";
import { CreateClassroomOnboarding } from "@/components/teacher/create-classroom-form";
import { signOutAction } from "@/lib/actions/auth";
import { getTeacherWorkspace } from "@/lib/auth/context";
import { loadPriceFreshness } from "@/lib/data/queries";

export const metadata: Metadata = {
  title: "Teacher dashboard",
  description: "Manage a classroom trading simulation.",
};

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, classrooms, classroom } = await getTeacherWorkspace();

  // A teacher account always gets a classroom at signup, but one created some
  // other way may not have any yet.
  if (!classroom) {
    return <CreateClassroomOnboarding name={session.profile.fullName} />;
  }

  const freshness = await loadPriceFreshness();

  return (
    <AppShell
      role="teacher"
      classrooms={classrooms.map((item) => ({
        id: item.id,
        name: item.name,
        section: item.section,
        joinCode: item.joinCode,
      }))}
      activeClassroomId={classroom.id}
      user={{
        name: session.profile.fullName || "Teacher",
        detail: session.email ?? "",
        signOut: signOutAction,
      }}
      priceFreshness={
        <PriceFreshness
          fetchedAt={freshness.fetchedAt}
          stale={freshness.stale}
        />
      }
    >
      {children}
    </AppShell>
  );
}
