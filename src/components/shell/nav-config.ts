import {
  Activity,
  Bookmark,
  ChartLine,
  ClipboardList,
  Coins,
  LayoutDashboard,
  Newspaper,
  SlidersHorizontal,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Rendered in the mobile tab bar. */
  primary?: boolean;
};

/**
 * Nav configuration lives in its own module rather than being passed from a
 * server component into a client one, because React cannot serialise component
 * references across that boundary.
 */
export const TEACHER_NAV: NavItem[] = [
  { href: "/teacher", label: "Overview", icon: LayoutDashboard, primary: true },
  { href: "/teacher/students", label: "Students", icon: Users, primary: true },
  { href: "/teacher/activity", label: "Activity", icon: Activity, primary: true },
  { href: "/teacher/leaderboard", label: "Leaderboard", icon: Trophy, primary: true },
  {
    href: "/teacher/competitions",
    label: "Competitions",
    icon: ClipboardList,
  },
  { href: "/teacher/controls", label: "Controls", icon: SlidersHorizontal, primary: true },
];

export const STUDENT_NAV: NavItem[] = [
  { href: "/student", label: "Portfolio", icon: LayoutDashboard, primary: true },
  { href: "/student/market", label: "Market", icon: ChartLine, primary: true },
  { href: "/student/holdings", label: "Investments", icon: Coins, primary: true },
  { href: "/student/activity", label: "Activity", icon: Activity, primary: true },
  { href: "/student/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/student/news", label: "News", icon: Newspaper },
  { href: "/student/leaderboard", label: "Leaderboard", icon: Trophy, primary: true },
];

export function navFor(role: "teacher" | "student"): NavItem[] {
  return role === "teacher" ? TEACHER_NAV : STUDENT_NAV;
}

export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/teacher" || href === "/student") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function labelForPath(nav: NavItem[], pathname: string): string {
  const matches = nav
    .filter((item) => isActivePath(item.href, pathname))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.label ?? "Dashboard";
}
