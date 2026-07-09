import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createBooking,
  findBookingsByClassId,
  findBookingsByUserId,
  findClassById,
  findMembershipPlanById,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntryByClassAndUser,
  findWaitlistEntriesByClassId,
  saveWaitlistEntry,
  saveSubscription,
  type BookingRecord,
} from "@/lib/db";
import { hasActiveMembership, membershipIsRequired } from "@/lib/membership";
import { issueWaitlistOffer } from "@/lib/scheduling";
import { isClassEligibleForPlan, remainingSessions } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

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
  const plan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;

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
        return NextResponse.json(
          {
            success: false,
            message: "You've used all of your sessions for this billing period.",
          },
          { status: 403 }
        );
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

  if (subscription) {
    saveSubscription({
      ...subscription,
      sessionsUsedThisPeriod: subscription.sessionsUsedThisPeriod + 1,
      updatedAt: new Date().toISOString(),
    });
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

  return NextResponse.json(
    { success: true, message: "Class booked." },
    { status: 201 }
  );
}
