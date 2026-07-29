import { cookies } from "next/headers";

import {
  findBodyWeightLogsByUserId,
  findBookingsByUserId,
  findClassById,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { buildMemberStatsData } from "@/lib/member-stats";
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

  // Training stats — flattened server-side so the card can filter by range
  // client-side without shipping raw exercise rows.
  const workouts = findWorkoutSessionsByUserId(user.id);
  const bookings = findBookingsByUserId(user.id);
  const classDateById: Record<string, string> = {};
  for (const booking of bookings) {
    if (classDateById[booking.classId]) continue;
    const classRecord = findClassById(booking.classId);
    if (classRecord) classDateById[booking.classId] = classRecord.date;
  }
  const statsData = buildMemberStatsData(workouts, bookings, classDateById);

  return (
    <ProfileForm
      email={user.email}
      profile={syncedProfile}
      bodyWeightLogs={bodyWeightLogs}
      statsData={statsData}
    />
  );
}
