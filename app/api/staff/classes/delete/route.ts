import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createNotification,
  deleteBooking,
  deleteClass,
  deleteWaitlistEntry,
  findAllWaitlistEntries,
  findBookingsByClassId,
  findClassById,
  findClassSeriesById,
  findProfileByUserId,
  findSubscriptionByUserId,
  findUserById,
  saveClassSeries,
  saveSubscription,
  type NotificationRecord,
} from "@/lib/db";
import { classStartMs } from "@/lib/class-time";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { reversePassConsumption } from "@/lib/payments";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { sendPush } from "@/lib/push";
import { sendEmail } from "@/lib/email";
import { classCancelledEmail } from "@/lib/email-templates";
import { removeSyncedWeeklyTrainingSession } from "@/lib/weekly-training-sync";
import { requireTenantAccess } from "@/lib/tenant-request";

// Deletes an upcoming class and unwinds every reservation against it.
// Each booked member gets their pass back in whichever pool paid for it:
// a pack-pass booking gets an auditable consume_reversal ledger entry,
// a plan-allowance booking gets its monthly counter decremented. Past or
// in-progress classes can't be deleted — attendance history must survive.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage classes." },
      { status: 401 }
    );
  }

  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;

  if (!can(user.role, "classes.manage")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage classes." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "A class is required." },
      { status: 400 }
    );
  }

  const classRecord = findClassById(id.trim());

  if (!classRecord) {
    return NextResponse.json(
      { success: false, message: "This class no longer exists." },
      { status: 404 }
    );
  }

  // A class with no coachUserId shouldn't exist (it's stamped at creation),
  // but treat that as not-found rather than assume ownership. This check
  // must run before any of the booking-cancellation/waitlist/notification
  // side effects below, so a denied cross-gym request has zero effect.
  if (!classRecord.coachUserId || !sameGymAsStaff(user, classRecord.coachUserId)) {
    return NextResponse.json(
      { success: false, message: "This class no longer exists." },
      { status: 404 }
    );
  }

  const classStart = classStartMs(classRecord.date, classRecord.startTime);

  if (classStart <= Date.now()) {
    return NextResponse.json(
      {
        success: false,
        message: "Past classes can't be deleted — attendance history is kept.",
      },
      { status: 409 }
    );
  }

  const bookings = findBookingsByClassId(classRecord.id);
  let passesRestored = 0;
  const now = new Date().toISOString();

  for (const booking of bookings) {
    // The club cancelled, so the member always gets their credit back —
    // no cancellation-window rule applies. Reverse whichever pool paid.
    let creditRestored = false;
    if (reversePassConsumption(booking.id, "Class cancelled by the club — pass returned")) {
      passesRestored += 1;
      creditRestored = true;
    } else {
      const subscription = findSubscriptionByUserId(booking.userId);

      if (subscription && subscription.sessionsUsedThisPeriod > 0) {
        saveSubscription({
          ...subscription,
          sessionsUsedThisPeriod: subscription.sessionsUsedThisPeriod - 1,
          updatedAt: now,
        });
        passesRestored += 1;
        creditRestored = true;
      }
    }

    deleteBooking(booking.id);

    try {
      removeSyncedWeeklyTrainingSession(booking.userId, booking.id);
    } catch {
      // Non-critical — the deletion itself has already succeeded.
    }

    // Gym-initiated class cancellation: in-app and push, and (owner decision 2026-11-17) an email too, because a push alone can be missed and the member
    // needs to know the class isn't happening. Credit claim only when this member's credit was actually restored, otherwise neutral.
    const cancellationNotification: NotificationRecord = {
      id: randomUUID(),
      userId: booking.userId,
      type: "cancellation",
      body:
        `${classRecord.title} on ${classRecord.date} at ${classRecord.startTime} has been cancelled by the club.` +
        (creditRestored ? " Your class pass has been returned." : ""),
      title: "Class cancelled",
      readAt: null,
      linkHref: "/dashboard/schedule",
      dedupeKey: `class-deleted:${classRecord.id}:${booking.userId}`,
      createdAt: now,
    };
    createNotification(cancellationNotification);

    const affectedProfile = findProfileByUserId(booking.userId);
    if (affectedProfile?.pushNotificationsEnabled !== false) {
      void sendPush(booking.userId, {
        title: cancellationNotification.title,
        body: cancellationNotification.body,
        linkHref: cancellationNotification.linkHref ?? "/dashboard/schedule",
      });
    }
    if (affectedProfile?.emailNotificationsEnabled !== false && affectedProfile?.email) {
      const email = classCancelledEmail({
        memberName: affectedProfile.fullName || affectedProfile.email,
        className: classRecord.title,
        classDate: new Date(classRecord.date).toLocaleDateString("en-IE", { weekday: "short", month: "short", day: "numeric" }),
        startTime: classRecord.startTime,
        creditRestored,
      });
      // Once per class and member, so a retried request can't email twice.
      void sendEmail({ to: affectedProfile.email, ...email, kind: "class-cancelled", dedupeKey: `class-cancelled:${classRecord.id}:${booking.userId}` });
    }
  }

  // Remove every waitlist entry for the class, terminal states included —
  // there is nothing left to queue for once the class is gone.
  for (const entry of findAllWaitlistEntries()) {
    if (entry.classId === classRecord.id) {
      deleteWaitlistEntry(entry.id);
    }
  }

  // A deleted series occurrence is a deliberate cancellation of that day —
  // tombstone the date so rolling generation never re-creates it.
  if (classRecord.seriesId) {
    const series = findClassSeriesById(classRecord.seriesId);
    if (series && !series.skippedDates.includes(classRecord.date)) {
      saveClassSeries({
        ...series,
        skippedDates: [...series.skippedDates, classRecord.date],
        updatedAt: now,
      });
    }
  }

  deleteClass(classRecord.id);

  const message =
    bookings.length === 0
      ? "Class deleted."
      : `Class deleted. ${bookings.length} booking${bookings.length === 1 ? "" : "s"} cancelled, ${passesRestored} pass${passesRestored === 1 ? "" : "es"} restored.`;

  return NextResponse.json({ success: true, message }, { status: 200 });
}
