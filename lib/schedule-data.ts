import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";

import {
  findBookingsByClassId,
  findClassCategories,
  findClasses,
  findDeletedCategoryLabels,
  findProfileByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntriesByClassId,
  type ClassCategoryRecord,
} from "./db";
import { classStartMs } from "@/lib/class-time";
import { resolveBookingsForUser } from "./bookings";
import { hasActiveMembership, membershipIsRequired } from "./membership";
import { getCancellationCutoffHours } from "./scheduling";
import { isClassEligibleForPlan, remainingSessions } from "./scheduling-status";

export interface ScheduleClass {
  id: string;
  title: string;
  category: string;
  date: string;
  startTime: string;
  durationMins: number;
  capacity: number;
  coachEmail: string;
  imageUrl: string | null;
  imageAlt: string | null;
  bookedCount: number;
  isBookedByMe: boolean;
  isWaitlistedByMe: boolean;
  waitlistPosition: number | null;
  waitlistOfferState: "queued" | "offered" | null;
  waitlistEntryId: string | null;
  offerExpiresAt: string | null;
  isFull: boolean;
  blockReason: string | null;
}

export interface ScheduleUpcomingBooking {
  bookingId: string;
  classId: string;
  title: string;
  category: string;
  date: string;
  startTime: string;
  durationMins: number;
  attended: boolean;
}

// Past bookings carry the same shape as upcoming ones — `attended` only
// becomes meaningful once the class has happened, but keeping one shape
// means the mobile client can render both with one row component.
export type SchedulePastBooking = ScheduleUpcomingBooking;

export interface ScheduleData {
  classes: ScheduleClass[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
  remainingSessions: number | null;
  noActiveMembership: boolean;
  upcomingBookings: ScheduleUpcomingBooking[];
  pastBookings: SchedulePastBooking[];
  cancellationCutoffHours: number;
}

// Single source of truth for the Schedule tab, shared by the web page
// (app/(dashboard)/dashboard/schedule/page.tsx) and the mobile JSON API
// (app/api/mobile/schedule/route.ts).
export function getScheduleData(userId: string | undefined): ScheduleData | null {
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  if (!user || !profile) return null;

  const subscription = user.role === "member" ? findSubscriptionByUserId(user.id) : undefined;
  const plan = resolveSubscriptionEntitlement(subscription);
  const remaining = plan && subscription ? remainingSessions(plan, subscription) : null;
  const noActiveMembership = user.role === "member" && membershipIsRequired() && !hasActiveMembership(user.id);

  const now = Date.now();

  const resolvedBookings = resolveBookingsForUser(user.id, now);
  const myBookedClassIds = new Set(resolvedBookings.map((b) => b.classId));

  const upcomingBookings: ScheduleUpcomingBooking[] = resolvedBookings
    .filter((b) => !b.isPast)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .map((b) => ({
      bookingId: b.bookingId,
      classId: b.classId,
      title: b.title,
      category: b.category,
      date: b.date,
      startTime: b.startTime,
      durationMins: b.durationMins,
      attended: b.attended,
    }));

  const pastBookings: SchedulePastBooking[] = resolvedBookings
    .filter((b) => b.isPast)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime))
    .map((b) => ({
      bookingId: b.bookingId,
      classId: b.classId,
      title: b.title,
      category: b.category,
      date: b.date,
      startTime: b.startTime,
      durationMins: b.durationMins,
      attended: b.attended,
    }));

  const classes: ScheduleClass[] = findClasses()
    .filter((classRecord) => classStartMs(classRecord.date, classRecord.startTime) >= now)
    .map((classRecord) => {
      const bookedCount = findBookingsByClassId(classRecord.id).length;
      const isBookedByMe = myBookedClassIds.has(classRecord.id);
      const waitlist = findWaitlistEntriesByClassId(classRecord.id);
      const myEntry = waitlist.find((entry) => entry.userId === user.id);
      const isWaitlistedByMe = !!myEntry;
      const queuedEntries = waitlist.filter((e) => e.offerState === "queued");
      const waitlistPosition =
        myEntry?.offerState === "queued" ? queuedEntries.findIndex((e) => e.userId === user.id) + 1 : null;
      const waitlistOfferState =
        myEntry?.offerState === "offered" || myEntry?.offerState === "queued" ? myEntry.offerState : null;
      const waitlistEntryId = myEntry?.id ?? null;
      const offerExpiresAt = myEntry?.offerExpiresAt ?? null;

      const offeredCount = waitlist.filter((e) => e.offerState === "offered").length;
      const effectiveFull = bookedCount + offeredCount >= classRecord.capacity;

      let blockReason: string | null = null;
      if (!isBookedByMe && !isWaitlistedByMe && user.role === "member") {
        if (noActiveMembership) {
          blockReason = "No active membership";
        } else if (plan && !isClassEligibleForPlan(classRecord.category, plan)) {
          blockReason = `Not included in your plan (${plan.name})`;
        } else if (remaining !== null && remaining <= 0) {
          blockReason = "No remaining sessions this period";
        }
      }

      return {
        id: classRecord.id,
        title: classRecord.title,
        category: classRecord.category,
        date: classRecord.date,
        startTime: classRecord.startTime,
        durationMins: classRecord.durationMins,
        capacity: classRecord.capacity,
        coachEmail: findUserById(classRecord.coachUserId)?.email ?? "Unknown coach",
        imageUrl: classRecord.imageUrl ?? null,
        imageAlt: classRecord.imageAlt ?? null,
        bookedCount,
        isBookedByMe,
        isWaitlistedByMe,
        waitlistPosition,
        waitlistOfferState,
        waitlistEntryId,
        offerExpiresAt,
        isFull: effectiveFull,
        blockReason,
      };
    });

  return {
    classes,
    categories: findClassCategories(),
    deletedLabels: findDeletedCategoryLabels(),
    remainingSessions: remaining,
    noActiveMembership,
    upcomingBookings,
    pastBookings,
    cancellationCutoffHours: getCancellationCutoffHours(),
  };
}
