import { cookies } from "next/headers";

import {
  findBookingsByClassId,
  findBookingsByUserId,
  findClassById,
  findClassCategories,
  findClasses,
  findDeletedCategoryLabels,
  findMembershipPlanById,
  findProfileByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntriesByClassId,
} from "@/lib/db";
import { hasActiveMembership, membershipIsRequired } from "@/lib/membership";
import { getCancellationCutoffHours, isCancellationEarly } from "@/lib/scheduling";
import { isClassEligibleForPlan, remainingSessions } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";
import { ScheduleView } from "./ScheduleView";

export default async function DashboardSchedulePage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-display text-[28px]">Schedule</h1>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load profile data for this account. Try logging out and back in.
          </p>
        </div>
      </div>
    );
  }

  const allBookings = findBookingsByUserId(user.id);
  const myBookedClassIds = new Set(allBookings.map((b) => b.classId));

  const subscription = user.role === "member" ? findSubscriptionByUserId(user.id) : undefined;
  const plan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;
  const remaining = plan && subscription ? remainingSessions(plan, subscription) : null;
  const noActiveMembership =
    user.role === "member" && membershipIsRequired() && !hasActiveMembership(user.id);

  const now = Date.now();

  const upcomingBookings = allBookings
    .flatMap((booking) => {
      const classRecord = findClassById(booking.classId);
      if (!classRecord) return [];
      const classDateTime = new Date(`${classRecord.date}T${classRecord.startTime}`);
      if (classDateTime.getTime() < now) return [];
      return [
        {
          bookingId: booking.id,
          classId: classRecord.id,
          title: classRecord.title,
          date: classRecord.date,
          startTime: classRecord.startTime,
          durationMins: classRecord.durationMins,
          coachEmail: findUserById(classRecord.coachUserId)?.email ?? "Unknown coach",
          willRestoreSession: isCancellationEarly(classDateTime),
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const classes = findClasses()
    .filter(
      (classRecord) => new Date(`${classRecord.date}T${classRecord.startTime}`).getTime() >= now
    )
    .map((classRecord) => {
      const bookedCount = findBookingsByClassId(classRecord.id).length;
      const isBookedByMe = myBookedClassIds.has(classRecord.id);
      const isFull = bookedCount >= classRecord.capacity;

      const waitlist = findWaitlistEntriesByClassId(classRecord.id); // active only
      const myEntry = waitlist.find((entry) => entry.userId === user.id);
      const isWaitlistedByMe = !!myEntry;
      // Position is only meaningful while queued; offered members have already
      // been "served" and their slot is held separately.
      const queuedEntries = waitlist.filter((e) => e.offerState === "queued");
      const waitlistPosition =
        myEntry?.offerState === "queued"
          ? queuedEntries.findIndex((e) => e.userId === user.id) + 1
          : null;
      const waitlistOfferState =
        myEntry?.offerState === "offered" || myEntry?.offerState === "queued"
          ? myEntry.offerState
          : null;
      const waitlistEntryId = myEntry?.id ?? null;
      const offerExpiresAt = myEntry?.offerExpiresAt ?? null;

      // Open offers hold slots — count them against capacity for direct-booking
      // and join-waitlist checks.
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
        ...classRecord,
        coachEmail: findUserById(classRecord.coachUserId)?.email ?? "Unknown coach",
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

  return (
    <ScheduleView
      classes={classes}
      categories={findClassCategories()}
      deletedLabels={findDeletedCategoryLabels()}
      remainingSessions={remaining}
      noActiveMembership={noActiveMembership}
      upcomingBookings={upcomingBookings}
      cancellationCutoffHours={getCancellationCutoffHours()}
    />
  );
}
