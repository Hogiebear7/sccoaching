import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { findNotificationsByUserId, findUserById } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { NotificationsView } from "./NotificationsView";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) redirect("/login");

  const notifications = findNotificationsByUserId(user.id);

  return <NotificationsView initialNotifications={notifications} />;
}
