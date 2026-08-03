// Membership + class reporting for the staff Reports tab (admin+ — see
// lib/permissions.ts "reports.view"). No monetary figures here — see
// lib/finance.ts for revenue. Every number is derived from data this app
// already stores as a side effect of normal use; nothing new is tracked.
//
// SERVER-ONLY: this imports lib/db.ts (Node's `fs`). This module just shapes
// raw rows; the actual range filtering and grouping are pure functions in
// lib/reports-shared.ts, which is safe to import from client components.

import {
  findAllBookings,
  findAllSubscriptions,
  findClassCategories,
  findClasses,
  findDeletedCategoryLabels,
  findMembers,
  findProfileByUserId,
  findUserById,
} from "@/lib/db";
import { classCategoryLabel } from "@/lib/scheduling-status";
import type { ClassReportRow, MemberSignupRow, SubscriptionRow } from "@/lib/reports-shared";

export * from "@/lib/reports-shared";

export function buildMemberSignupRows(): MemberSignupRow[] {
  return findMembers().map((m) => ({
    userId: m.id,
    email: m.email,
    fullName: findProfileByUserId(m.id)?.fullName ?? null,
    createdAt: m.createdAt,
  }));
}

export function buildSubscriptionRows(): SubscriptionRow[] {
  return findAllSubscriptions().map((s) => ({
    userId: s.userId,
    email: findUserById(s.userId)?.email ?? "Unknown member",
    fullName: findProfileByUserId(s.userId)?.fullName ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    status: s.status,
  }));
}

export function buildClassReportRows(): ClassReportRow[] {
  const categories = findClassCategories();
  const deletedLabels = findDeletedCategoryLabels();
  const bookings = findAllBookings();

  const bookingsByClassId = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const list = bookingsByClassId.get(b.classId) ?? [];
    list.push(b);
    bookingsByClassId.set(b.classId, list);
  }

  return findClasses()
    .map((c) => {
      const classBookings = bookingsByClassId.get(c.id) ?? [];
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
