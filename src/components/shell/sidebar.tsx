"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { cn } from "@/lib/utils";
import { isActivePath, navFor } from "./nav-config";

/**
 * Desktop navigation. Hierarchy comes from a surface lift on the active row and
 * nothing else — no accent bars, no gradients.
 */
export function Sidebar({ role }: { role: "teacher" | "student" }) {
  const nav = React.useMemo(() => navFor(role), [role]);
  const pathname = usePathname();

  return (
    <aside className="hidden w-[228px] shrink-0 border-r border-hairline lg:flex lg:flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span
          aria-hidden
          className="grid size-6 place-items-center rounded-[6px] bg-brand text-[12px] font-semibold text-white"
        >
          P
        </span>
        <span className="text-[13px] font-medium tracking-tight text-ink">
          PaperDesk
        </span>
        <span className="ml-1 rounded-full border border-hairline bg-surface-2 px-1.5 py-[1px] text-[10px] text-ink-tertiary">
          Sim
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Main">
        {nav.map((item) => {
          const active = isActivePath(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors",
                active
                  ? "bg-surface-2 text-ink"
                  : "text-ink-subtle hover:bg-surface-2/60 hover:text-ink-muted",
              )}
            >
              <item.icon
                className={cn("size-4", active ? "text-ink-muted" : "text-ink-tertiary")}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-hairline px-4 py-3">
        <p className="text-[11px] leading-relaxed text-ink-tertiary">
          Virtual money only.
          <br />
          No real orders are placed.
        </p>
      </div>
    </aside>
  );
}
