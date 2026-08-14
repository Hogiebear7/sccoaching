import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createBooking,
  findBookingsByClassId,
  findBookingsByUserId,
  findClassById,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntryByClassAndUser,
  findWaitlistEntriesByClassId,
  saveWaitlistEntry,
  saveSubscription,
  type BookingRecord,
} from "@/lib/db";
import { hasActiveMembership, membershipIsRequired } from "@/lib/membership";
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
      { success: false, message: "You must be signed in to book a class." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to book a class." },
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

  if (
    user.role === "member" &&
    membershipIsRequired() &&
    !hasActiveMembership(user.id)
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "An active membership is required to book classes. Select a plan on the Membership page.",
      },
      { status: 403 }
    );
  }

  const { classId } = (body ?? {}) as Record<string, unknown>;

  if (typeof classId !== "string" || !classId.trim()) {
    return NextResponse.json(
      { success: false, message: "A class is required." },
      { status: 400 }
    );
  }

  const classRecord = findClassById(classId);

  if (!classRecord) {
    return NextResponse.json(
      { success: false, message: "This class no longer exists." },
      { status: 404 }
    );
  }

  const classDateTime = new Date(`${classRecord.date}T${classRecord.startTime}`);

  if (classDateTime.getTime() < Date.now()) {
    return NextResponse.json(
      { success: false, message: "This class has already started." },
      { status: 409 }
    );
  }

  const alreadyBooked = findBookingsByUserId(user.id).some(
    (booking) => booking.classId === classId
  );

  if (alreadyBooked) {
    return NextResponse.json(
      { success: false, message: "You have already booked this class." },
      { status: 409 }
    );
  }

  const subscription = user.role === "member" ? findSubscriptionByUserId(user.id) : undefined;
  const plan = resolveSubscriptionEntitlement(subscription);
  let coverWithPurchasedPass = false;

  if (user.role === "member") {
    if (subscription && plan && !isClassEligibleForPlan(classRecord.category, plan)) {
      return NextResponse.json(
        {
          success: false,
          message: `Your plan (${plan.name}) doesn't include access to this class type.`,
        },
        { status: 403 }
      );
    }

    if (subscription && plan) {
      const remaining = remainingSessions(plan, subscription);

      if (remaining !== null && remaining <= 0) {
        // Monthly allowance exhausted — purchased pass packs cover the
        // overflow. The actual consume happens after the booking exists so
        // the ledger entry carries the booking id.
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
  }

  const currentBookings = findBookingsByClassId(classId).length;
  // Open offers hold slots against capacity — a slot being offered to someone
  // else is not available for a direct booking.
  const activeWaitlist = findWaitlistEntriesByClassId(classId);
  const offeredCount = activeWaitlist.filter((e) => e.offerState === "offered").length;

  if (currentBookings + offeredCount >= classRecord.capacity) {
    return NextResponse.json(
      {
        success: false,
        message: "This class is full. Join the waitlist and you'll receive an offer if a spot opens.",
        full: true,
      },
      { status: 409 }
    );
  }

  const booking: BookingRecord = {
    id: randomUUID(),
    classId,
    userId: user.id,
    attendedAt: null,
    createdAt: new Date().toISOString(),
  };

  createBooking(booking);

  // This booking may be filling a spot vacated by someone else's late
  // cancellation — if so, restore their credit now that it's genuinely
  // been refilled. Unrelated to this booker's own payment below.
  try {
    resolvePendingCancellationCreditsForClass(classId);
  } catch {
    // Must never block this member's own booking from completing.
  }

  // If staff already prepared a workout for this class, it shows up in the
  // member's Workouts tab immediately — no need to wait for check-in.
  syncClassWorkoutToMember(classId, user.id);

  if (subscription) {
    if (coverWithPurchasedPass) {
      // Ledger debit, keyed to the booking — the monthly counter is not
      // touched, so plan usage and pack usage stay separately auditable.
      consumePurchasedPass({ userId: user.id, bookingId: booking.id });
    } else {
      saveSubscription({
        ...subscription,
        sessionsUsedThisPeriod: subscription.sessionsUsedThisPeriod + 1,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // Booking directly supersedes any active waitlist entry for this class.
  // If the entry was "offered", mark it removed and cascade to the next person
  // so the slot that was being held by the offer is re-issued.
  const staleWaitlistEntry = findWaitlistEntryByClassAndUser(classId, user.id);
  if (staleWaitlistEntry) {
    const wasOffered = staleWaitlistEntry.offerState === "offered";
    saveWaitlistEntry({
      ...staleWaitlistEntry,
      offerState: "removed",
      resolvedAt: new Date().toISOString(),
    });
    if (wasOffered) {
      try {
        issueWaitlistOffer(classId);
      } catch {
        // Cascade failure must not block the booking.
      }
    }
  }

  // Confirmed booking event → fire-and-forget confirmation email (gated on the
  // member's email prefs inside the helper; never blocks the response).
  sendBookingConfirmationEmail(user.id, classRecord);

  return NextResponse.json(
    { success: true, message: "Class booked." },
    { status: 201 }
  );
}
