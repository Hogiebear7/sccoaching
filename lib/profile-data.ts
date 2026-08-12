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
import type { DietaryPreference, Gender, MeasurementUnits, PrimaryGoal } from "./profile-schema";

export interface ProfileData {
  email: string;
  fullName: string;
  phone: string;
  dateOfBirth: string | null;
  gender: Gender;
  primaryGoal: PrimaryGoal;
  sportPlayed: string | null;
  additionalInfo: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContact2Name: string | null;
  emergencyContact2Phone: string | null;
  currentWeightKg: number | null;
  dietaryPreference: DietaryPreference;
  allergies: string[];
  intolerancesOrMedical: string[];
  dietaryNotes: string | null;
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  reminderTimingsMins: number[] | null;
  preferredUnits: MeasurementUnits;
  avatarDataUrl: string | null;
  // Gates whether the client shows a "Cycle Tracking" entry point at all —
  // mirrors the web nav's same check. See app/api/mobile/cycle/route.ts for
  // the actual cycle data once a member navigates in.
  cycleTrackingEligible: boolean;
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
    emergencyContactName: profile.emergencyContactName ?? null,
    emergencyContactPhone: profile.emergencyContactPhone ?? null,
    emergencyContact2Name: profile.emergencyContact2Name ?? null,
    emergencyContact2Phone: profile.emergencyContact2Phone ?? null,
    currentWeightKg: resolveCurrentWeightKg(profile.currentWeightKg, bodyWeightLogs),
    dietaryPreference: profile.dietaryPreference ?? "standard",
    allergies: profile.allergies ?? [],
    intolerancesOrMedical: profile.intolerancesOrMedical ?? [],
    dietaryNotes: profile.dietaryNotes ?? null,
    pushNotificationsEnabled: profile.pushNotificationsEnabled,
    emailNotificationsEnabled: profile.emailNotificationsEnabled,
    reminderTimingsMins: profile.reminderTimingsMins ?? null,
    preferredUnits: profile.preferredUnits ?? "metric",
    avatarDataUrl: profile.avatarDataUrl ?? null,
    cycleTrackingEligible: profile.cycleTrackingEligible,
    allTimeStats: sumStatsInRange(statsData, null, null),
  };
}
