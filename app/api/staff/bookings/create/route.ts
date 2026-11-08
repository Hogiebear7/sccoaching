import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sendBookingConfirmationEmail } from "@/lib/booking-emails";
import { resolvePendingCancellationCreditsForClass } from "@/lib/cancellation-credits";
import { classStartDate } from "@/lib/class-time";
import { syncClassWorkoutToMember } from "@/lib/class-workout-sync";
import {
  createBooking,
  createNotification,
  createWaitlistEntry,
  findBookingsByClassId,
  findBookingsByUserId,
  findClassById,
  findProfileByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntriesByClassId,
  findWaitlistEntryByClassAndUser,
  saveSubscription,
  saveWaitlistEntry,
  type BookingRecord,
  type NotificationRecord,
  type WaitlistEntryRecord,
} from "@/lib/db";
import { sameGym, sameGymAsStaff } from "@/lib/gym-scope";
import { hasActiveMembership, membershipIsRequired } from "@/lib/membership";
import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { consumePurchasedPass, purchasedPassBalance } from "@/lib/payments";
import { can } from "@/lib/permissions";
import { sendPush } from "@/lib/push";
import { issueWaitlistOffer } from "@/lib/scheduling";
import { isClassEligibleForPlan, remainingSessions } from "@/lib/scheduling-status";
import { syncBookingToWeeklyTraining } from "@/lib/weekly-training-sync";

// MUST equal MAX_WAITLIST_SIZE in app/api/bookings/waitlist/join/route.ts (a test asserts they match).
const MAX_WAITLIST_SIZE = 2;

// A coach or admin books a MEMBER into a class on the member's behalf (e.g. someone who can't use the app).
// Every rule the member's own booking applies still applies; this route exists so the member route is untouched:
//   - same gym for staff, member and class; members only; archived members are refused
//   - active membership, an emergency contact on the profile, plan class-type eligibility
//   - the plan's session allowance, then purchased pass packs; nothing is overridden
//   - a full class puts the member on the waitlist instead; a full waitlist is refused
// The member gets the normal booking confirmation (in-app, push, email).
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "You must be signed in to manage bookings." }, { status: 401 });
  }

  if (!can(staffUser.role, "classes.manage")) {
    return NextResponse.json({ success: false, message: "Only staff can book a member into a class." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { classId, userId } = (body ?? {}) as Record<string, unknown>;

  if (typeof classId !== "string" || !classId.trim()) {
    return NextResponse.json({ success: false, message: "A class is required." }, { status: 400 });
  }
  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ success: false, message: "A member is required." }, { status: 400 });
  }

  const member = findUserById(userId);
  const classRecord = findClassById(classId);

  // Cross-gym, missing, archived and non-member targets all read as "not found", before anything is written.
  if (!member || member.role !== "member" || member.archivedAt || !sameGym(staffUser, member)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  if (
    !classRecord ||
    !classRecord.coachUserId ||
    !sameGymAsStaff(staffUser, classRecord.coachUserId) ||
    !sameGymAsStaff(member, classRecord.coachUserId)
  ) {
    return NextResponse.json({ success: false, message: "This class no longer exists." }, { status: 404 });
  }

  if (classStartDate(classRecord.date, classRecord.startTime).getTime() < Date.now()) {
    return NextResponse.json({ success: false, message: "This class has already started." }, { status: 409 });
  }

  if (membershipIsRequired() && !hasActiveMembership(member.id)) {
    return NextResponse.json(
      { success: false, message: "This member needs an active membership to be booked into classes." },
      { status: 403 }
    );
  }

  const memberProfile = findProfileByUserId(member.id);
  if (!memberProfile?.emergencyContactName || !memberProfile?.emergencyContactPhone) {
    return NextResponse.json(
      { success: false, message: "Add an emergency contact to this member's profile before booking them." },
      { status: 403 }
    );
  }

  if (findBookingsByUserId(member.id).some((booking) => booking.classId === classId)) {
    return NextResponse.json({ success: false, message: "This member is already booked into this class." }, { status: 409 });
  }

  const subscription = findSubscriptionByUserId(member.id);
  const plan = resolveSubscriptionEntitlement(subscription);
  let coverWithPurchasedPass = false;

  if (subscription && plan && !isClassEligibleForPlan(classRecord.category, plan)) {
    return NextResponse.json(
      { success: false, message: `This member's plan (${plan.name}) doesn't include access to this class type.` },
      { status: 403 }
    );
  }

  if (subscription && plan) {
    const remaining = remainingSessions(plan, subscription);
    if (remaining !== null && remaining <= 0) {
      if (purchasedPassBalance(member.id) > 0) {
        coverWithPurchasedPass = true;
      } else {
        return NextResponse.json(
          { success: false, message: "This member has used all of their sessions for this billing period and has no pass packs left." },
          { status: 403 }
        );
      }
    }
  }

  const currentBookings = findBookingsByClassId(classId).length;
  const activeWaitlist = findWaitlistEntriesByClassId(classId);
  const offeredCount = activeWaitlist.filter((e) => e.offerState === "offered").length;

  // Full class: waitlist (same cap as a member joining; a live offer adds one bonus slot).
  if (currentBookings + offeredCount >= classRecord.capacity) {
    if (findWaitlistEntryByClassAndUser(classId, member.id)) {
      return NextResponse.json({ success: false, message: "This member is already on the waitlist for this class." }, { status: 409 });
    }
    if (activeWaitlist.length >= MAX_WAITLIST_SIZE + offeredCount) {
      return NextResponse.json(
        { success: false, message: "This class and its waitlist are both full, so this member can't be added." },
        { status: 409 }
      );
    }

    const entry: WaitlistEntryRecord = {
      id: randomUUID(),
      classId,
      userId: member.id,
      offerState: "queued",
      offerExpiresAt: null,
      warningNotifiedAt: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    createWaitlistEntry(entry);

    return NextResponse.json(
      {
        success: true,
        outcome: "waitlisted",
        message: "The class is full, so this member has been added to the waitlist. They'll get an offer if a spot opens.",
      },
      { status: 201 }
    );
  }

  const booking: BookingRecord = {
    id: randomUUID(),
    classId,
    userId: member.id,
    attendedAt: null,
    noShowProcessedAt: null,
    createdAt: new Date().toISOString(),
  };
  createBooking(booking);

  try {
    resolvePendingCancellationCreditsForClass(classId);
  } catch {
    // Must never block the booking.
  }

  syncClassWorkoutToMember(classId, member.id);

  try {
    syncBookingToWeeklyTraining(member.id, classRecord, booking.id);
  } catch {
    // Non-critical; the booking has already succeeded.
  }

  if (subscription) {
    if (coverWithPurchasedPass) {
      consumePurchasedPass({ userId: member.id, bookingId: booking.id });
    } else {
      saveSubscription({
        ...subscription,
        sessionsUsedThisPeriod: subscription.sessionsUsedThisPeriod + 1,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // A booking supersedes any waitlist entry for this class, and a held offer cascades to the next person.
  const staleWaitlistEntry = findWaitlistEntryByClassAndUser(classId, member.id);
  if (staleWaitlistEntry) {
    const wasOffered = staleWaitlistEntry.offerState === "offered";
    saveWaitlistEntry({ ...staleWaitlistEntry, offerState: "removed", resolvedAt: new Date().toISOString() });
    if (wasOffered) {
      try {
        issueWaitlistOffer(classId);
      } catch {
        // Cascade failure must not block the booking.
      }
    }
  }

  sendBookingConfirmationEmail(member.id, classRecord);

  const notification: NotificationRecord = {
    id: randomUUID(),
    userId: member.id,
    type: "booking_confirmed",
    title: `Booked: ${classRecord.title}`,
    body: `Our team booked you into ${classRecord.title} on ${new Date(classRecord.date).toLocaleDateString("en-IE", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })} at ${classRecord.startTime}.`,
    readAt: null,
    linkHref: "/dashboard/bookings",
    dedupeKey: `booking:${booking.id}:confirmation`,
    createdAt: new Date().toISOString(),
  };
  createNotification(notification);

  if (memberProfile.pushNotificationsEnabled !== false) {
    void sendPush(member.id, { title: notification.title, body: notification.body, linkHref: notification.linkHref ?? "/dashboard/bookings" });
  }

  return NextResponse.json({ success: true, outcome: "booked", message: "Member booked into the class." }, { status: 201 });
}
