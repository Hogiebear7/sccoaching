import {
  findBookingsByUserId,
  findCoachNoteByUserId,
  findMembers,
  findProfileByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "./db";
import { resolveSubscriptionEntitlement } from "./membership-entitlement";

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

export interface StaffMemberDetail extends StaffMemberSummary {
  dateOfBirth: string | null;
  primaryGoal: string;
  sportPlayed: string | null;
  currentPeriodEnd: string | null;
  totalSessionsLogged: number;
  totalBookings: number;
  lastSessionDate: string | null;
  // Internal, staff-only — never shown to the member. Edited via the
  // existing /api/staff/members/notes route (members.edit, coach-tier).
  coachNotes: string | null;
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
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    totalSessionsLogged: sessions.length,
    totalBookings: bookings.length,
    lastSessionDate: lastSession?.date ?? null,
    coachNotes: findCoachNoteByUserId(member.id)?.notes ?? null,
  };
}
