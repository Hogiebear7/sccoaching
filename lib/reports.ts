// Membership + class reporting for the staff Reports tab (admin+ — see
// lib/permissions.ts "reports.view"). No monetary figures here — see
// lib/finance.ts for revenue. Every number is derived from data this app
// already stores as a side effect of normal use; nothing new is tracked.
//
// SERVER-ONLY: this imports lib/db.ts (Node's `fs`). This module just shapes
// raw rows; the actual range filtering and grouping are pure functions in
// lib/reports-shared.ts, which is safe to import from client components.

import {
  findAllSubscriptions,
  findBookingsByClassId,
  findClassCategories,
  findClasses,
  findDeletedCategoryLabels,
  findMembers,
  findProfileByUserId,
  findUserById,
} from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { classCategoryLabel } from "@/lib/scheduling-status";
import type { ClassReportRow, MemberSignupRow, SubscriptionRow } from "@/lib/reports-shared";

export * from "@/lib/reports-shared";

// Every builder below is scoped to the acting staff member's own gym (`staff`
// is the server-resolved session user, never a client value; gymId null is the
// primary gym, lib/gym-scope.ts). Rows for other gyms' members/classes are
// excluded BEFORE any profile, user, or booking lookup, and anything whose
// owner can't be resolved is excluded (fail closed). Callers: the staff Reports
// page and lib/staff-business-data.ts (mobile Business) — both staff-facing.
type ReportActor = { gymId?: string | null };

export function buildMemberSignupRows(staff: ReportActor): MemberSignupRow[] {
  return findMembers()
    .filter((m) => sameGym(staff, m))
    .map((m) => ({
      userId: m.id,
      email: m.email,
      fullName: findProfileByUserId(m.id)?.fullName ?? null,
      createdAt: m.createdAt,
    }));
}

export function buildSubscriptionRows(staff: ReportActor): SubscriptionRow[] {
  return findAllSubscriptions()
    .map((s) => ({ subscription: s, member: findUserById(s.userId) }))
    .filter(({ member }) => !!member && sameGym(staff, member))
    .map(({ subscription: s, member }) => ({
      userId: s.userId,
      email: member?.email ?? "Unknown member",
      fullName: findProfileByUserId(s.userId)?.fullName ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      status: s.status,
    }));
}

export function buildClassReportRows(staff: ReportActor): ClassReportRow[] {
  const categories = findClassCategories();
  const deletedLabels = findDeletedCategoryLabels();

  // A class belongs to its coach's gym (class -> coachUserId -> gym).
  return findClasses()
    .filter((c) => {
      const coach = findUserById(c.coachUserId);
      return !!coach && sameGym(staff, coach);
    })
    .map((c) => {
      const classBookings = findBookingsByClassId(c.id);
      return {
        classId: c.id,
        title: c.title,
        date: c.date,
        startTime: c.startTime,
        categoryLabel: classCategoryLabel(categories, c.category, deletedLabels),
        bookingCount: classBookings.length,
        capacity: c.capacity,
        attendedCount: classBookings.filter((b) => b.attendedAt !== null).length,
      };
    })
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
}
