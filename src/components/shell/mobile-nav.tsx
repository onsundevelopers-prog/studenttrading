"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { isActivePath, navFor } from "./nav-config";

/**
 * Mobile navigation: a drawer for the full list plus a fixed tab bar for the five
 * destinations that actually get used mid-lesson.
 *
 * Takes a `role` rather than a nav array because the nav items carry icon
 * components, and React cannot serialise component references from a server
 * component into a client one.
 */
export function MobileNav({
  role,
  title,
  subtitle,
}: {
  role: "teacher" | "student";
  title: string;
  subtitle?: string;
}) {
  const nav = React.useMemo(() => navFor(role), [role]);
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const primary = nav.filter((item) => item.primary).slice(0, 5);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          aria-label="Open navigation"
          className="inline-flex size-8 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
        >
          <Menu className="size-4" />
        </DialogTrigger>
        <DialogContent className="max-w-xs">
          <DialogHeader title={title} description={subtitle} />
          <nav className="space-y-0.5">
            {nav.map((item) => {
              const active = isActivePath(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                    active
                      ? "bg-surface-4 text-ink"
                      : "text-ink-subtle hover:bg-surface-3 hover:text-ink",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </DialogContent>
      </Dialog>

      {/* Fixed tab bar; the padding clears the iOS home indicator. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/95 backdrop-blur-sm lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const active = isActivePath(item.href, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors",
                    active ? "text-ink" : "text-ink-tertiary",
                  )}
                >
                  <item.icon
                    className={cn("size-[18px]", active && "text-brand-hover")}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
