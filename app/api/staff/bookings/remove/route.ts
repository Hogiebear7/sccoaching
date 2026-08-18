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
import { reversePassConsumption } from "@/lib/payments";
import { issueWaitlistOffer } from "@/lib/scheduling";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// Staff-initiated removal from a booked class — distinct from a member's own
// cancellation (app/api/bookings/cancel/route.ts). This is an administrative
// action, not the member's choice to forfeit a spot late, so it always fully
// restores the credit regardless of the cancellation-window timing rule.
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage bookings." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || !can(staffUser.role, "classes.manage")) {
    return NextResponse.json(
      { success: false, message: "Only staff can remove a member from a class." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { bookingId } = (body ?? {}) as Record<string, unknown>;

  if (typeof bookingId !== "string" || !bookingId.trim()) {
    return NextResponse.json({ success: false, message: "A booking is required." }, { status: 400 });
  }

  const booking = findBookingById(bookingId);

  if (!booking) {
    return NextResponse.json({ success: false, message: "This booking no longer exists." }, { status: 404 });
  }

  let creditRestored = false;

  if (reversePassConsumption(bookingId, "Removed from class by staff — pass returned")) {
    creditRestored = true;
  } else {
    const subscription = findSubscriptionByUserId(booking.userId);
    if (subscription) {
      saveSubscription({
        ...subscription,
        sessionsUsedThisPeriod: Math.max(0, subscription.sessionsUsedThisPeriod - 1),
        updatedAt: new Date().toISOString(),
      });
      creditRestored = true;
    }
  }

  deleteBooking(bookingId);

  const classRecord = findClassById(booking.classId);
  if (classRecord) {
    try {
      issueWaitlistOffer(classRecord.id);
    } catch {
      // Offer failure must never block the removal response.
    }
  }

  return NextResponse.json(
    {
      success: true,
      message: creditRestored
        ? "Member removed from the class. Their credit was restored."
        : "Member removed from the class.",
    },
    { status: 200 }
  );
}
