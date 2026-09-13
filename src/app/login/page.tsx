import type { Metadata } from "next";
import Link from "next/link";

import { AuthPanel } from "@/components/shell/auth-panel";
import { ClassCodeForm } from "@/components/shell/class-code-form";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <AuthPanel
      title="Sign in"
      description="A classroom trading simulator. Every balance, price and trade here is virtual."
      footer={
        <>
          Setting up a class?{" "}
          <Link
            href="/signup"
            className="text-ink-muted underline decoration-hairline-strong underline-offset-2 transition-colors hover:text-ink"
          >
            Create a teacher account
          </Link>
        </>
      }
    >
      <LoginForm next={next} />

      <div className="mt-4">
        <div className="mb-3 flex items-center gap-3">
          <span aria-hidden className="h-px flex-1 bg-hairline" />
          <span className="text-[11px] uppercase tracking-wide text-ink-tertiary">
            or
          </span>
          <span aria-hidden className="h-px flex-1 bg-hairline" />
        </div>
        <ClassCodeForm />
      </div>
    </AuthPanel>
  );
}
