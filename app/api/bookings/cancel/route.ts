import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  deleteBooking,
  findBookingById,
  findClassById,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
} from "@/lib/db";
import { promoteFromWaitlist, isCancellationEarly } from "@/lib/scheduling";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

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

  if (classRecord) {
    const classDateTime = new Date(`${classRecord.date}T${classRecord.startTime}`);

    if (classDateTime.getTime() < Date.now()) {
      return NextResponse.json(
        { success: false, message: "This class has already started and can no longer be cancelled." },
        { status: 409 }
      );
    }

    if (isCancellationEarly(classDateTime)) {
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
  }

  deleteBooking(bookingId);

  if (classRecord) {
    promoteFromWaitlist(classRecord.id);
  }

  const message = sessionRestored
    ? "Booking cancelled. Your session credit was restored."
    : classRecord
      ? "Booking cancelled. This was within the cancellation window, so the session was not restored."
      : "Booking cancelled.";

  return NextResponse.json({ success: true, sessionRestored, message }, { status: 200 });
}
