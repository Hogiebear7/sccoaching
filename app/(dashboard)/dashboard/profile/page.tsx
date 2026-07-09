import { cookies } from "next/headers";

import { findBodyWeightLogsByUserId, findProfileByUserId, findUserById } from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { verifySession } from "@/lib/session";
import { ProfileForm } from "./ProfileForm";

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-display text-[28px]">Profile</h1>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load profile data for this account. Try logging out and
            back in.
          </p>
        </div>
      </div>
    );
  }

  const bodyWeightLogs = findBodyWeightLogsByUserId(user.id);

  // Display the synced weight: latest log wins over the stored field.
  const syncedProfile = {
    ...profile,
    currentWeightKg: resolveCurrentWeightKg(profile.currentWeightKg, bodyWeightLogs),
  };

  return <ProfileForm email={user.email} profile={syncedProfile} bodyWeightLogs={bodyWeightLogs} />;
}
