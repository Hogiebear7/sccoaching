import { cookies } from "next/headers";

import { findProfileByUserId, findUserById } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { ProfileForm } from "./ProfileForm";

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return (
      <div className="space-y-5 pt-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load profile data for this account. Try logging out and
            back in.
          </p>
        </div>
      </div>
    );
  }

  return <ProfileForm email={user.email} profile={profile} />;
}
