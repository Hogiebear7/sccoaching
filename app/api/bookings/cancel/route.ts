import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createNotification,
  deleteBooking,
  findBookingById,
  findClassById,
  findProfileByUserId,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type NotificationRecord,
} from "@/lib/db";
import { classStartDate } from "@/lib/class-time";
import { creditSourceForBooking, trackLateCancellationCredit } from "@/lib/cancellation-credits";
import { reversePassConsumption } from "@/lib/payments";
import { issueWaitlistOffer, isCancellationEarly } from "@/lib/scheduling";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { sendPush } from "@/lib/push";
import { removeSyncedWeeklyTrainingSession } from "@/lib/weekly-training-sync";

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to cancel a booking." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to cancel a booking." },
      { status: 401 }
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

  const { bookingId } = (body ?? {}) as Record<string, unknown>;

  if (typeof bookingId !== "string" || !bookingId.trim()) {
    return NextResponse.json(
      { success: false, message: "A booking is required." },
      { status: 400 }
    );
  }

  const booking = findBookingById(bookingId);

  if (!booking) {
    return NextResponse.json(
      { success: false, message: "This booking no longer exists." },
      { status: 404 }
    );
  }

  if (booking.userId !== user.id) {
    return NextResponse.json(
      { success: false, message: "You can only cancel your own bookings." },
      { status: 403 }
    );
  }

  const classRecord = findClassById(booking.classId);
  let sessionRestored = false;
  let creditPending = false;

  if (classRecord) {
    const classDateTime = classStartDate(classRecord.date, classRecord.startTime);

    if (classDateTime.getTime() < Date.now()) {
      return NextResponse.json(
        { success: false, message: "This class has already started and can no longer be cancelled." },
        { status: 409 }
      );
    }

    if (isCancellationEarly(classDateTime)) {
      // Same cancellation-window rule for both pools. If this booking spent
      // a purchased pass, return that pass (once); otherwise refund the
      // monthly counter as before. Late cancellations keep either consumed
      // — unless the vacated spot gets filled before the class starts, see
      // trackLateCancellationCredit below.
      if (reversePassConsumption(bookingId)) {
        sessionRestored = true;
      } else {
        const subscription = findSubscriptionByUserId(user.id);

        if (subscription) {
          saveSubscription({
            ...subscription,
            sessionsUsedThisPeriod: Math.max(0, subscription.sessionsUsedThisPeriod - 1),
            updatedAt: new Date().toISOString(),
          });
          sessionRestored = true;
        }
      }
    } else {
      // Late cancellation — forfeit by default, but track it as reversible:
      // if a waitlisted member accepts the offer this cancellation triggers
      // below (or anyone else books the now-open spot before the class
      // starts), the credit comes back. Skipped when nothing was actually
      // consumed for this booking (e.g. a staff-side booking with no
      // subscription) — nothing to potentially restore.
      const creditSource = creditSourceForBooking(bookingId, user.id);
      if (creditSource) {
        trackLateCancellationCredit({ classId: classRecord.id, userId: user.id, bookingId, creditSource });
        creditPending = true;
      }
    }
  }

  deleteBooking(bookingId);

  try {
    removeSyncedWeeklyTrainingSession(user.id, bookingId);
  } catch {
    // Non-critical — the cancellation itself has already succeeded.
  }

  if (classRecord) {
    try {
      issueWaitlistOffer(classRecord.id);
    } catch {
      // Offer failure must never block the cancellation response.
    }

    // Successful cancellation of an existing class → push-only notification
    // (no email — see the class-notification channel policy in lib/db.ts).
    // Only claims restored credit when it actually applied.
    const cancellationNotification: NotificationRecord = {
      id: randomUUID(),
      userId: user.id,
      type: "booking_cancelled",
      title: `Cancelled: ${classRecord.title}`,
      body:
        `Your booking for ${classRecord.title} on ${new Date(classRecord.date).toLocaleDateString("en-IE", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })} has been cancelled.` + (sessionRestored ? " Your session credit was restored." : ""),
      readAt: null,
      linkHref: "/dashboard/bookings",
      dedupeKey: `booking:${bookingId}:cancellation`,
      createdAt: new Date().toISOString(),
    };
    createNotification(cancellationNotification);

    const cancellingProfile = findProfileByUserId(user.id);
    if (cancellingProfile?.pushNotificationsEnabled !== false) {
      void sendPush(user.id, {
        title: cancellationNotification.title,
        body: cancellationNotification.body,
        linkHref: cancellationNotification.linkHref ?? "/dashboard/bookings",
      });
    }
  }

  const message = sessionRestored
    ? "Booking cancelled. Your session credit was restored."
    : creditPending
      ? "Booking cancelled. This was within the cancellation window, so your credit isn't restored for now — but if someone else takes the spot before the class starts, it will be."
      : classRecord
        ? "Booking cancelled. This was within the cancellation window, so the session was not restored."
        : "Booking cancelled.";

  return NextResponse.json({ success: true, sessionRestored, message }, { status: 200 });
}
