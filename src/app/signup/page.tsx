import type { Metadata } from "next";
import Link from "next/link";

import { AuthPanel } from "@/components/shell/auth-panel";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create a classroom" };

export default function SignupPage() {
  return (
    <AuthPanel
      title="Create a classroom"
      description="Set up a simulated market for your class. You choose the starting capital, the trading window and which assets are allowed."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-ink-muted underline decoration-hairline-strong underline-offset-2 transition-colors hover:text-ink"
          >
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthPanel>
  );
}
