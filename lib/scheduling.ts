import { randomUUID } from "crypto";

import {
  createNotification,
  findBookingsByClassId,
  findBookingsByUserId,
  findClassById,
  findMembershipPlanById,
  findProfileByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWaitlistEntriesByClassId,
  saveWaitlistEntry,
  type NotificationRecord,
} from "./db";
import { sendEmail } from "./email";
import { waitlistOfferEmail } from "./email-templates";
import { sendPush } from "./push";
import { hasActiveMembership } from "./membership";
import { purchasedPassBalance } from "./payments";
import { isClassEligibleForPlan, remainingSessions } from "./scheduling-status";

const DEFAULT_CANCELLATION_CUTOFF_HOURS = 3;

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

function classDateTimeMs(date: string, startTime: string): number {
  const [h, m] = startTime.split(":").map(Number);
  const dt = new Date(date);
  dt.setHours(h, m, 0, 0);
  return dt.getTime();
}

const THREE_HOURS_MS  = 3 * 60 * 60 * 1000;
const NINETY_MINS_MS  = 90 * 60 * 1000;
const THIRTY_MINS_MS  = 30 * 60 * 1000;

// Returns the offer response window (in ms) based on how far the class is.
//   class > 3 hr away  → 3 hr window
//   90 min – 3 hr away → 90 min window
//   < 90 min away      → 30 min window
export function computeOfferWindowMs(classMs: number, nowMs: number): number {
  const timeUntilClass = classMs - nowMs;
  if (timeUntilClass > THREE_HOURS_MS) return THREE_HOURS_MS;
  if (timeUntilClass > NINETY_MINS_MS) return NINETY_MINS_MS;
  return THIRTY_MINS_MS;
}

// Called whenever a confirmed slot opens up (member cancels or staff raises
// capacity). Issues a provisional offer to the first eligible queued member —
// exactly one offer per available slot. The slot is held against capacity
// while the offer is open.
//
// Ineligible members (inactive membership, wrong plan, no sessions) are
// skipped but left in the queue — their circumstances may change. Ghost
// entries and members already booked into this class are marked removed.
export function issueWaitlistOffer(classId: string): void {
  const classRecord = findClassById(classId);
  if (!classRecord) return;

  const classMs = classDateTimeMs(classRecord.date, classRecord.startTime);
  const now = Date.now();

  if (classMs <= now) return; // class has started — nothing to offer

  const activeEntries = findWaitlistEntriesByClassId(classId);
  const bookingsCount = findBookingsByClassId(classId).length;
  const offeredCount = activeEntries.filter((e) => e.offerState === "offered").length;

  // Effective occupancy = confirmed bookings + slots already held by open offers.
  if (bookingsCount + offeredCount >= classRecord.capacity) return;

  const queuedEntries = activeEntries.filter((e) => e.offerState === "queued");
  const nowIso = new Date().toISOString();

  for (const entry of queuedEntries) {
    const member = findUserById(entry.userId);

    if (!member) {
      // Ghost entry — mark removed and move on.
      saveWaitlistEntry({ ...entry, offerState: "removed", resolvedAt: nowIso });
      continue;
    }

    if (findBookingsByUserId(member.id).some((b) => b.classId === classId)) {
      // Already booked via another path — stale entry, clean up.
      saveWaitlistEntry({ ...entry, offerState: "removed", resolvedAt: nowIso });
      continue;
    }

    // Eligibility checks — skip (not remove) so the member keeps their queue
    // position if they resolve the issue (renew membership, buy sessions, etc).
    if (!hasActiveMembership(member.id)) continue;

    const subscription = findSubscriptionByUserId(member.id);
    const plan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;
    if (!subscription || !plan) continue;

    if (!isClassEligibleForPlan(classRecord.category, plan)) continue;

    const remaining = remainingSessions(plan, subscription);
    if (remaining !== null && remaining <= 0 && purchasedPassBalance(entry.userId) <= 0) continue;

    // Issue the offer.
    const windowMs = computeOfferWindowMs(classMs, now);
    const offerExpiresAt = new Date(now + windowMs).toISOString();

    saveWaitlistEntry({ ...entry, offerState: "offered", offerExpiresAt, warningNotifiedAt: null });

    const classDate = new Date(classRecord.date).toLocaleDateString("en-IE", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const expiryTime = new Date(now + windowMs).toLocaleTimeString("en-IE", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const expiryDate = new Date(now + windowMs).toLocaleDateString("en-IE", {
      month: "short",
      day: "numeric",
    });

    try {
      const notification: NotificationRecord = {
        id: randomUUID(),
        userId: member.id,
        type: "waitlist_offer",
        title: `Spot available: ${classRecord.title}`,
        body: `A spot opened in ${classRecord.title} on ${classDate}. Accept before ${expiryTime} on ${expiryDate} or it passes to the next person.`,
        readAt: null,
        linkHref: "/dashboard/schedule",
        dedupeKey: `waitlist-offer:${entry.id}`,
        createdAt: nowIso,
      };
      createNotification(notification);

      const profile = findProfileByUserId(member.id);
      if (profile?.emailNotificationsEnabled !== false && member.email) {
        const tmpl = waitlistOfferEmail({
          memberName: profile?.fullName || member.email,
          className: classRecord.title,
          classDate,
          expiryTime,
          expiryDate,
        });
        void sendEmail({ to: member.email, ...tmpl });
      }
      if (profile?.pushNotificationsEnabled !== false) {
        void sendPush(member.id, {
          title: notification.title,
          body: notification.body,
          linkHref: notification.linkHref ?? "/dashboard/schedule",
        });
      }
    } catch {
      // Notification failure must never block the offer itself.
    }

    return; // One offer issued per available slot.
  }
}
