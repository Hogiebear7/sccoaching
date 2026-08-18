import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createBooking,
  findClassById,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntryById,
  saveSubscription,
  saveWaitlistEntry,
  type BookingRecord,
} from "@/lib/db";
import { classStartDate } from "@/lib/class-time";
import { hasActiveMembership } from "@/lib/membership";
import { sendBookingConfirmationEmail } from "@/lib/booking-emails";
import { resolvePendingCancellationCreditsForClass } from "@/lib/cancellation-credits";
import { syncClassWorkoutToMember } from "@/lib/class-workout-sync";
import { issueWaitlistOffer } from "@/lib/scheduling";
import { consumePurchasedPass, purchasedPassBalance } from "@/lib/payments";
import { isClassEligibleForPlan, remainingSessions } from "@/lib/scheduling-status";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);
  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
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

  const { entryId, action } = (body ?? {}) as Record<string, unknown>;

  if (typeof entryId !== "string" || !entryId.trim()) {
    return NextResponse.json(
      { success: false, message: "entryId is required." },
      { status: 400 }
    );
  }
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json(
      { success: false, message: "action must be 'accept' or 'reject'." },
      { status: 400 }
    );
  }

  // All synchronous from here — no await between check and write, so Node.js's
  // single-threaded event loop prevents two concurrent requests from both
  // passing the state check and double-booking.
  const entry = findWaitlistEntryById(entryId);

  if (!entry) {
    return NextResponse.json(
      { success: false, message: "Waitlist offer not found." },
      { status: 404 }
    );
  }

  if (entry.userId !== user.id) {
    return NextResponse.json(
      { success: false, message: "This offer is not for your account." },
      { status: 403 }
    );
  }

  if (entry.offerState !== "offered") {
    const stateMessages: Record<string, string> = {
      queued:   "You don't have a pending offer for this class yet.",
      accepted: "This offer has already been accepted.",
      rejected: "This offer has already been declined.",
      expired:  "This offer has expired.",
      removed:  "This waitlist entry has been removed.",
    };
    return NextResponse.json(
      {
        success: false,
        message: stateMessages[entry.offerState] ?? "This offer is no longer active.",
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  if (entry.offerExpiresAt && entry.offerExpiresAt <= now) {
    saveWaitlistEntry({ ...entry, offerState: "expired", resolvedAt: now });
    try {
      issueWaitlistOffer(entry.classId);
    } catch {
      // Cascade failure is non-fatal.
    }
    return NextResponse.json(
      {
        success: false,
        message: "Your offer expired before you responded. The spot has been offered to the next person.",
      },
      { status: 409 }
    );
  }

  if (action === "reject") {
    saveWaitlistEntry({ ...entry, offerState: "rejected", resolvedAt: now });
    try {
      issueWaitlistOffer(entry.classId);
    } catch {
      // Cascade failure must not prevent the rejection completing.
    }
    return NextResponse.json({
      success: true,
      message: "Offer declined. You've been removed from the waitlist.",
    });
  }

  // --- Accept ---

  const classRecord = findClassById(entry.classId);
  if (!classRecord) {
    return NextResponse.json(
      { success: false, message: "Class not found." },
      { status: 404 }
    );
  }

  const classDateTime = classStartDate(classRecord.date, classRecord.startTime);
  if (classDateTime.getTime() < Date.now()) {
    saveWaitlistEntry({ ...entry, offerState: "expired", resolvedAt: now });
    return NextResponse.json(
      { success: false, message: "This class has already started." },
      { status: 409 }
    );
  }

  // Re-check eligibility in case membership/sessions changed since offer was issued.
  if (!hasActiveMembership(user.id)) {
    return NextResponse.json(
      {
        success: false,
        message: "Your membership is no longer active. Renew it to book this class.",
      },
      { status: 403 }
    );
  }

  const subscription = findSubscriptionByUserId(user.id);
  let coverWithPurchasedPass = false;
  const plan = resolveSubscriptionEntitlement(subscription);

  if (subscription && plan && !isClassEligibleForPlan(classRecord.category, plan)) {
    return NextResponse.json(
      { success: false, message: "Your plan no longer covers this class type." },
      { status: 403 }
    );
  }

  if (subscription && plan) {
    const remaining = remainingSessions(plan, subscription);
    if (remaining !== null && remaining <= 0) {
      if (purchasedPassBalance(user.id) > 0) {
        coverWithPurchasedPass = true;
      } else {
        return NextResponse.json(
          {
            success: false,
            message:
              "You've used all of your sessions for this billing period, and you have no pass packs left.",
          },
          { status: 403 }
        );
      }
    }
  }

  const booking: BookingRecord = {
    id: randomUUID(),
    classId: entry.classId,
    userId: user.id,
    attendedAt: null,
    noShowProcessedAt: null,
    createdAt: now,
  };

  createBooking(booking);

  // This offer being accepted may itself be the refill for a late
  // cancellation (the common case: someone cancels late, this offer goes
  // out as a direct result, they accept) — or an earlier still-pending one
  // if there's more than one outstanding for this class. Either way,
  // restore whichever is oldest now that a spot has genuinely been filled.
  try {
    resolvePendingCancellationCreditsForClass(entry.classId);
  } catch {
    // Must never block this member's own booking from completing.
  }

  // If staff already prepared a workout for this class, it shows up in the
  // member's Workouts tab immediately — no need to wait for check-in.
  syncClassWorkoutToMember(entry.classId, user.id);

  if (subscription) {
    if (coverWithPurchasedPass) {
      consumePurchasedPass({ userId: user.id, bookingId: booking.id });
    } else saveSubscription({
      ...subscription,
      sessionsUsedThisPeriod: subscription.sessionsUsedThisPeriod + 1,
      updatedAt: now,
    });
  }

  saveWaitlistEntry({ ...entry, offerState: "accepted", resolvedAt: now });

  // Accepting the offer created a confirmed booking → same confirmation email
  // as a direct booking (fire-and-forget, gated inside the helper).
  sendBookingConfirmationEmail(user.id, classRecord);

  return NextResponse.json({
    success: true,
    message: "Booking confirmed! You're booked in.",
  });
}
