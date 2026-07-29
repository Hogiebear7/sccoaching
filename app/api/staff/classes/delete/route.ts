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
  findSubscriptionByUserId,
  findUserById,
  saveClassSeries,
  saveSubscription,
} from "@/lib/db";
import { reversePassConsumption } from "@/lib/payments";
import { sendClassCancelledEmail } from "@/lib/booking-emails";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

// Deletes an upcoming class and unwinds every reservation against it.
// Each booked member gets their pass back in whichever pool paid for it:
// a pack-pass booking gets an auditable consume_reversal ledger entry,
// a plan-allowance booking gets its monthly counter decremented. Past or
// in-progress classes can't be deleted — attendance history must survive.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage classes." },
      { status: 401 }
    );
  }

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

  const classStart = new Date(`${classRecord.date}T${classRecord.startTime}`);

  if (classStart.getTime() <= Date.now()) {
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

    // Gym-initiated class-cancellation email to this affected member — non-
    // blocking, gated on the member's email prefs, credit claim only if true.
    sendClassCancelledEmail(booking.userId, classRecord, creditRestored);

    createNotification({
      id: randomUUID(),
      userId: booking.userId,
      type: "cancellation",
      // Match the email's conditional credit accuracy: only claim a returned
      // pass when this member's credit was actually restored, otherwise neutral.
      body:
        `${classRecord.title} on ${classRecord.date} at ${classRecord.startTime} has been cancelled by the club.` +
        (creditRestored ? " Your class pass has been returned." : ""),
      title: "Class cancelled",
      readAt: null,
      linkHref: "/dashboard/schedule",
      dedupeKey: `class-deleted:${classRecord.id}:${booking.userId}`,
      createdAt: now,
    });
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
