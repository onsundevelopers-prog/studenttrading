import type { Metadata } from "next";

import { AppShell } from "@/components/shell/app-shell";
import { PriceFreshness } from "@/components/shell/price-freshness";
import { signOutAction } from "@/lib/actions/auth";
import { getStudentWorkspace } from "@/lib/auth/context";
import { loadPriceFreshness } from "@/lib/data/queries";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Your simulated trading portfolio.",
};

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, classrooms, classroom } = await getStudentWorkspace();

  if (!classroom) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
        <Panel className="w-full p-6">
          <EmptyState
            title="You are not enrolled in a classroom yet."
            description="Ask your teacher for your handle and password, or for the class code, and they will add you to the simulation."
          />
          <form action={signOutAction} className="mt-5 flex justify-center">
            <Button type="submit" variant="secondary" size="md">
              Sign out
            </Button>
          </form>
        </Panel>
      </div>
    );
  }

  const freshness = await loadPriceFreshness();

  return (
    <AppShell
      role="student"
      classrooms={classrooms.map((item) => ({
        id: item.id,
        name: item.name,
        section: item.section,
        joinCode: item.joinCode,
      }))}
      activeClassroomId={classroom.id}
      user={{
        name:
          session.profile.fullName ||
          session.profile.loginHandle ||
          "Student",
        detail: session.profile.loginHandle ?? "",
        signOut: signOutAction,
      }}
      priceFreshness={
        <PriceFreshness fetchedAt={freshness.fetchedAt} stale={freshness.stale} />
      }
    >
      {children}
    </AppShell>
  );
}
