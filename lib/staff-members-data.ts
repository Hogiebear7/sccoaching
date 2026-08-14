import {
  findBookingsByUserId,
  findClassById,
  findCoachNoteByUserId,
  findMembers,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWeeklyTrainingScheduleByUserId,
  findWorkoutSessionsByUserId,
} from "./db";
import { resolveSubscriptionEntitlement } from "./membership-entitlement";
import type { WeeklyTrainingScheduleRecord } from "./profile-schema";
import {
  computePersonalBests,
  findPersonalBestByKeywords,
  TRACKED_PERSONAL_BEST_EXERCISES,
} from "./workouts";

export interface StaffMemberSummary {
  userId: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  joinedAt: string;
  archivedAt: string | null;
  currentPlanName: string | null;
  currentStatus: string | null;
}

// Mobile-first staff member list: everything needed to search and identify
// a member. The web app's /staff/members page additionally has billing
// actions, age-bracket demographics, and pass-package activation — a
// separate, larger mobile build (see lib/staff-classes-data.ts for the
// same "list is thin, editing tools deferred" tradeoff on the Classes side).
export function getStaffMembersData(): StaffMemberSummary[] {
  return findMembers().map((member) => {
    const profile = findProfileByUserId(member.id);
    const sub = findSubscriptionByUserId(member.id);
    const plan = resolveSubscriptionEntitlement(sub);
    return {
      userId: member.id,
      email: member.email,
      fullName: profile?.fullName ?? null,
      phone: profile?.phone ?? null,
      joinedAt: member.createdAt,
      archivedAt: member.archivedAt ?? null,
      currentPlanName: plan?.name ?? null,
      currentStatus: sub?.status ?? null,
    };
  });
}

export interface StaffMemberBookingSummary {
  bookingId: string;
  title: string;
  date: string;
  startTime: string;
  durationMins: number;
}

export interface StaffMemberPersonalBest {
  label: string;
  heaviestWeight: { weightStr: string; reps: number | null; date: string } | null;
  highestReps: { reps: number; date: string } | null;
}

export interface StaffMemberDetail extends StaffMemberSummary {
  dateOfBirth: string | null;
  primaryGoal: string;
  sportPlayed: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContact2Name: string | null;
  emergencyContact2Phone: string | null;
  currentPeriodEnd: string | null;
  totalSessionsLogged: number;
  totalBookings: number;
  lastSessionDate: string | null;
  // Internal, staff-only — never shown to the member. Edited via the
  // existing /api/staff/members/notes route (members.edit, coach-tier).
  coachNotes: string | null;
  latestReadinessScore: number | null;
  personalBests: StaffMemberPersonalBest[];
  upcomingBookings: StaffMemberBookingSummary[];
  pastBookings: StaffMemberBookingSummary[];
  weeklyTrainingSchedule: WeeklyTrainingScheduleRecord | null;
}

export function getStaffMemberDetail(userId: string): StaffMemberDetail | null {
  const member = findUserById(userId);
  if (!member) return null;

  const profile = findProfileByUserId(member.id);
  const sub = findSubscriptionByUserId(member.id);
  const plan = resolveSubscriptionEntitlement(sub);
  const sessions = findWorkoutSessionsByUserId(member.id);
  const bookings = findBookingsByUserId(member.id);
  const lastSession = [...sessions].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  const recoveryLogs = findRecoveryLogsByUserId(member.id);
  const latestReadinessScore = recoveryLogs[0]?.readinessScore ?? null;

  const allPersonalBests = computePersonalBests(sessions);
  const personalBests: StaffMemberPersonalBest[] = TRACKED_PERSONAL_BEST_EXERCISES.map(({ label, keywords }) => {
    const best = findPersonalBestByKeywords(allPersonalBests, keywords);
    return {
      label,
      heaviestWeight: best?.heaviestWeight
        ? { weightStr: best.heaviestWeight.weightStr, reps: best.heaviestWeight.reps, date: best.heaviestWeight.date }
        : null,
      highestReps: best?.highestReps ? { reps: best.highestReps.reps, date: best.highestReps.date } : null,
    };
  });

  const now = Date.now();
  const resolvedBookings = bookings
    .map((booking) => {
      const classRecord = findClassById(booking.classId);
      if (!classRecord) return null;
      return {
        bookingId: booking.id,
        title: classRecord.title,
        date: classRecord.date,
        startTime: classRecord.startTime,
        durationMins: classRecord.durationMins,
        isPast: new Date(`${classRecord.date}T${classRecord.startTime}`).getTime() < now,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const upcomingBookings = resolvedBookings
    .filter((b) => !b.isPast)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const pastBookings = resolvedBookings
    .filter((b) => b.isPast)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime))
    .slice(0, 10);

  return {
    userId: member.id,
    email: member.email,
    fullName: profile?.fullName ?? null,
    phone: profile?.phone ?? null,
    joinedAt: member.createdAt,
    archivedAt: member.archivedAt ?? null,
    currentPlanName: plan?.name ?? null,
    currentStatus: sub?.status ?? null,
    dateOfBirth: profile?.dateOfBirth ?? null,
    primaryGoal: profile?.primaryGoal ?? "General Health",
    sportPlayed: profile?.sportPlayed ?? null,
    emergencyContactName: profile?.emergencyContactName ?? null,
    emergencyContactPhone: profile?.emergencyContactPhone ?? null,
    emergencyContact2Name: profile?.emergencyContact2Name ?? null,
    emergencyContact2Phone: profile?.emergencyContact2Phone ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    totalSessionsLogged: sessions.length,
    totalBookings: bookings.length,
    lastSessionDate: lastSession?.date ?? null,
    coachNotes: findCoachNoteByUserId(member.id)?.notes ?? null,
    latestReadinessScore,
    personalBests,
    upcomingBookings,
    pastBookings,
    weeklyTrainingSchedule: findWeeklyTrainingScheduleByUserId(member.id) ?? null,
  };
}
