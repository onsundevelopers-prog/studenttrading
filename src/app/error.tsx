"use client";

import { CircleAlert, RotateCcw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/primitives";

/**
 * Route error boundary.
 *
 * Shows the digest so a teacher can report something specific, and never
 * pretends the page worked. The underlying message is intentionally not rendered
 * — it can contain implementation detail.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Unhandled application error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <Panel className="p-6">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-neg" />
          <div className="min-w-0">
            <h1 className="text-[15px] font-medium text-ink">
              Something went wrong on this page.
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-subtle">
              Nothing has been lost — every portfolio figure lives in the
              database, not in this page. Try again, and if it keeps happening
              give the reference below to whoever set up the simulation.
            </p>
            {error.digest ? (
              <p className="mt-3 font-mono text-[11px] text-ink-tertiary">
                reference: {error.digest}
              </p>
            ) : null}
            <div className="mt-5 flex gap-2">
              <Button type="button" size="md" variant="primary" onClick={reset}>
                <RotateCcw />
                Try again
              </Button>
              <Button asChild size="md" variant="secondary">
                <a href="/dashboard">Back to dashboard</a>
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
