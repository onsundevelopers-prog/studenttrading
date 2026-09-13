import Link from "next/link";
import type * as React from "react";

import { Panel } from "@/components/ui/primitives";

/**
 * Auth screen frame: a single narrow column on the deep canvas with a hairline
 * card. No illustration, no gradient — the product sells itself on restraint.
 */
export function AuthPanel({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-[6px] bg-brand text-[12px] font-semibold text-white"
          >
            P
          </span>
          <span className="text-[13px] font-medium tracking-tight text-ink">
            PaperDesk
          </span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[380px]">
          <div className="mb-5">
            <h1 className="text-headline font-medium text-ink">{title}</h1>
            {description ? (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-subtle">
                {description}
              </p>
            ) : null}
          </div>

          <Panel className="p-5">{children}</Panel>

          {footer ? (
            <div className="mt-5 text-center text-[12px] leading-relaxed text-ink-tertiary">
              {footer}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
