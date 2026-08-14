import { randomUUID } from "crypto";

import {
  createNotification,
  createPendingCancellationCredit,
  findPendingCancellationCreditsByClassId,
  findSubscriptionByUserId,
  findUserById,
  savePendingCancellationCredit,
  saveSubscription,
  type NotificationRecord,
  type PendingCancellationCreditRecord,
} from "./db";
import { hasConsumedPassForBooking, reversePassConsumption } from "./payments";
import { sendPush } from "./push";

// Determines what a booking's credit source would be if it needs tracking
// as a reversible late-cancellation forfeiture — null when nothing was
// actually consumed for it (e.g. a staff-side booking with no
// subscription), matching the same "was there a credit at stake" check the
// early-cancellation restore path already relies on.
export function creditSourceForBooking(
  bookingId: string,
  userId: string
): PendingCancellationCreditRecord["creditSource"] | null {
  if (hasConsumedPassForBooking(bookingId)) return "pass";
  return findSubscriptionByUserId(userId) ? "subscription" : null;
}

export function trackLateCancellationCredit(input: {
  classId: string;
  userId: string;
  bookingId: string;
  creditSource: PendingCancellationCreditRecord["creditSource"];
}): void {
  createPendingCancellationCredit({
    id: randomUUID(),
    classId: input.classId,
    userId: input.userId,
    bookingId: input.bookingId,
    creditSource: input.creditSource,
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  });
}

// Called whenever a NEW booking lands for a class (direct booking or a
// waitlist offer accepted) — if a late cancellation for this class is still
// waiting to see whether its spot gets refilled, the oldest one just did.
// Restores that member's credit (pass or subscription, whichever was
// actually consumed) and notifies them. A no-op if nothing's pending.
export function resolvePendingCancellationCreditsForClass(classId: string): void {
  const pending = findPendingCancellationCreditsByClassId(classId);
  if (pending.length === 0) return;

  const oldest = pending[0];
  const now = new Date().toISOString();

  let restored = false;
  if (oldest.creditSource === "pass") {
    restored = reversePassConsumption(oldest.bookingId, "Spot was refilled after a late cancellation — credit returned");
  } else {
    const subscription = findSubscriptionByUserId(oldest.userId);
    if (subscription) {
      saveSubscription({
        ...subscription,
        sessionsUsedThisPeriod: Math.max(0, subscription.sessionsUsedThisPeriod - 1),
        updatedAt: now,
      });
      restored = true;
    }
  }

  savePendingCancellationCredit({ ...oldest, status: "refilled", resolvedAt: now });

  if (!restored) return;

  try {
    const member = findUserById(oldest.userId);
    if (!member) return;

    const notification: NotificationRecord = {
      id: randomUUID(),
      userId: oldest.userId,
      type: "cancellation_credit_restored",
      title: "Your credit was restored",
      body: "Someone else took the spot you cancelled, so your session credit for that class has been given back to you.",
      readAt: null,
      linkHref: "/dashboard/membership",
      dedupeKey: `cancellation-credit-restored:${oldest.id}`,
      createdAt: now,
    };
    createNotification(notification);

    void sendPush(oldest.userId, {
      title: notification.title,
      body: notification.body,
      linkHref: notification.linkHref ?? "/dashboard/membership",
    });
  } catch {
    // Notification failure must never block the credit restoration itself.
  }
}
