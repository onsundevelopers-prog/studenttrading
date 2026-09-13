import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/session";

/**
 * Role router. The role comes from the profiles table, not from anything the
 * client can set.
 */
export default async function DashboardRouter() {
  const session = await getSessionContext();
  if (!session) redirect("/login");

  redirect(session.profile.role === "teacher" ? "/teacher" : "/student");
}
