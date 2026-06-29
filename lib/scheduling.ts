import { randomUUID } from "crypto";

import {
  createBooking,
  createMessage,
  deleteWaitlistEntry,
  findBookingsByClassId,
  findBookingsByUserId,
  findClassById,
  findMembershipPlanById,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntriesByClassId,
  saveSubscription,
  type BookingRecord,
} from "./db";
import { hasActiveMembership } from "./membership";
import { isClassEligibleForPlan, remainingSessions } from "./scheduling-status";

const DEFAULT_CANCELLATION_CUTOFF_HOURS = 12;

export function getCancellationCutoffHours(): number {
  const raw = process.env.CANCELLATION_CUTOFF_HOURS?.trim();
  if (!raw) return DEFAULT_CANCELLATION_CUTOFF_HOURS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CANCELLATION_CUTOFF_HOURS;

  return parsed;
}

// True if cancelling right now is early enough (relative to the configured
// cutoff) that the member's session credit should be restored.
export function isCancellationEarly(classDateTime: Date): boolean {
  const cutoffMs = getCancellationCutoffHours() * 60 * 60 * 1000;
  return classDateTime.getTime() - Date.now() > cutoffMs;
}

// Called whenever a confirmed spot opens up (a cancellation, or staff
// raising a class's capacity). Promotes at most one person — exactly one
// spot opened, so exactly one promotion is correct. Skips anyone no longer
// eligible: inactive membership, wrong plan for this class's category, or
// no remaining sessions. Skipped entries are left on the waitlist as-is.
export function promoteFromWaitlist(classId: string): void {
  const classRecord = findClassById(classId);
  if (!classRecord) return;

  const bookedCount = findBookingsByClassId(classId).length;
  if (bookedCount >= classRecord.capacity) return;

  const waitlist = findWaitlistEntriesByClassId(classId);

  for (const entry of waitlist) {
    const member = findUserById(entry.userId);
    if (!member) {
      continue;
    }

    if (findBookingsByUserId(member.id).some((b) => b.classId === classId)) {
      // Already booked somehow (e.g. raced with a direct booking) — drop
      // the now-redundant waitlist entry and move on.
      deleteWaitlistEntry(entry.id);
      continue;
    }

    if (!hasActiveMembership(member.id)) continue;

    const subscription = findSubscriptionByUserId(member.id);
    const plan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;
    if (!subscription || !plan) continue;

    if (!isClassEligibleForPlan(classRecord.category, plan)) continue;

    const remaining = remainingSessions(plan, subscription);
    if (remaining !== null && remaining <= 0) continue;

    const now = new Date().toISOString();
    const booking: BookingRecord = {
      id: randomUUID(),
      classId,
      userId: member.id,
      attendedAt: null,
      createdAt: now,
    };

    createBooking(booking);
    saveSubscription({
      ...subscription,
      sessionsUsedThisPeriod: subscription.sessionsUsedThisPeriod + 1,
      updatedAt: now,
    });
    deleteWaitlistEntry(entry.id);

    try {
      createMessage({
        id: randomUUID(),
        memberId: member.id,
        senderId: classRecord.coachUserId,
        senderRole: "staff",
        body: `Good news — a spot opened up and you've been booked into "${classRecord.title}" on ${classRecord.date} at ${classRecord.startTime}.`,
        createdAt: now,
      });
    } catch {
      // Notification is a nice-to-have; never let it block the promotion.
    }

    return;
  }
}
