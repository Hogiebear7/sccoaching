import {
  findBodyWeightLogsByUserId,
  findBookingsByUserId,
  findClassById,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "./db";
import { resolveCurrentWeightKg } from "./body-weight";
import { buildMemberStatsData, sumStatsInRange, type MemberStatTotals } from "./member-stats";
import type { DietaryPreference, Gender, PrimaryGoal } from "./profile-schema";

export interface ProfileData {
  email: string;
  fullName: string;
  phone: string;
  dateOfBirth: string | null;
  gender: Gender;
  primaryGoal: PrimaryGoal;
  sportPlayed: string | null;
  additionalInfo: string | null;
  currentWeightKg: number | null;
  dietaryPreference: DietaryPreference;
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  // All-time only — the web app's date-range picker on stats is deliberately
  // not replicated on mobile; see app/(dashboard)/dashboard/profile/
  // ProfileStatsCard.tsx for the full version.
  allTimeStats: MemberStatTotals;
}

// Shared by the web Profile page (app/(dashboard)/dashboard/profile/
// page.tsx) and the mobile JSON API (app/api/mobile/profile/route.ts).
// Writes go through the existing /api/profile/update and
// /api/profile/push-notifications endpoints (already Bearer-compatible) —
// this covers everything needed to render the mobile Profile screen.
export function getProfileData(userId: string | undefined): ProfileData | null {
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  if (!user || !profile) return null;

  const bodyWeightLogs = findBodyWeightLogsByUserId(user.id);
  const workouts = findWorkoutSessionsByUserId(user.id);
  const bookings = findBookingsByUserId(user.id);
  const classDateById: Record<string, string> = {};
  for (const booking of bookings) {
    if (classDateById[booking.classId]) continue;
    const classRecord = findClassById(booking.classId);
    if (classRecord) classDateById[booking.classId] = classRecord.date;
  }
  const statsData = buildMemberStatsData(workouts, bookings, classDateById);

  return {
    email: user.email,
    fullName: profile.fullName,
    phone: profile.phone,
    dateOfBirth: profile.dateOfBirth,
    gender: profile.gender,
    primaryGoal: profile.primaryGoal,
    sportPlayed: profile.sportPlayed,
    additionalInfo: profile.additionalInfo,
    currentWeightKg: resolveCurrentWeightKg(profile.currentWeightKg, bodyWeightLogs),
    dietaryPreference: profile.dietaryPreference ?? "standard",
    pushNotificationsEnabled: profile.pushNotificationsEnabled,
    emailNotificationsEnabled: profile.emailNotificationsEnabled,
    allTimeStats: sumStatsInRange(statsData, null, null),
  };
}
