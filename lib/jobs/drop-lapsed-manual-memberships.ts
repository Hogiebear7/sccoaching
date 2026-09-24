import { randomUUID } from "crypto";

import {
  createMessage,
  createNotification,
  findAllSubscriptions,
  findAnyStaffUser,
  type NotificationRecord,
} from "@/lib/db";
import { isPeriodLapsed } from "@/lib/membership-status";
import { grantMemberTier } from "@/lib/tier-grant";
import { findSystemSenderForMember } from "./system-sender";
import type { JobDefinition } from "./types";

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

// Nothing today ever steps a lapsed member down from their paid tier —
// resolveMemberTier() stays at full tier for as long as status stays
// "active", and only a real Stripe/Google Play subscription ever gets that
// status changed for it (via their own webhook-driven dunning/cancellation,
// already handled elsewhere). A manually-administered membership
// (provider: "none" — cash payments, comps, staff-granted tiers) has no
// external system driving its lifecycle at all, so it would otherwise keep
// full access forever once granted. This job is what actually drops those
// members to Free, 3 days after their period ends — giving them a short
// grace window (matching what notifyLapsedMembershipsJob already warns them
// about on day 0) before losing app-tier access. Booking itself already
// blocks new bookings and keeps the calendar + existing bookings visible
// throughout, via lib/membership.ts's hasActiveMembership() — nothing here
// needs to touch that.
export const dropLapsedManualMembershipsJob: JobDefinition = {
  name: "drop-lapsed-manual-memberships",
  description: "Drops manually-administered memberships to Free tier once lapsed for more than 3 days.",
  async run() {
    const subscriptions = findAllSubscriptions();
    if (!findAnyStaffUser()) {
      return "Skipped: no staff account exists to send notifications from.";
    }

    let droppedCount = 0;

    for (const subscription of subscriptions) {
      if (subscription.provider !== "none") continue;
      if (!isPeriodLapsed(subscription)) continue;

      const lapsedForMs = Date.now() - new Date(subscription.currentPeriodEnd!).getTime();
      if (lapsedForMs <= GRACE_PERIOD_MS) continue;

      const result = await grantMemberTier(subscription.userId, "free");
      if (!result.ok) continue;

      const now = new Date().toISOString();

      // Attributed to a staff user in THIS member's gym (never another gym's
      // staff); a gym with no staff skips the message but the tier drop above
      // and the notification below still happen.
      const sender = findSystemSenderForMember(subscription.userId);
      if (sender) {
        createMessage({
          id: randomUUID(),
          memberId: subscription.userId,
          senderId: sender.id,
          senderRole: "staff",
          body: "Your membership period ended more than 3 days ago, so your plan has moved to Free. Renew any time on the Membership page to restore full access.",
          readAt: null,
          createdAt: now,
        });
      }

      const notification: NotificationRecord = {
        id: randomUUID(),
        userId: subscription.userId,
        type: "membership",
        title: "Your plan has moved to Free",
        body: "Your membership period ended more than 3 days ago. Renew any time to restore full access.",
        readAt: null,
        linkHref: "/dashboard/membership",
        dedupeKey: null,
        createdAt: now,
      };
      createNotification(notification);

      droppedCount += 1;
    }

    return droppedCount === 0
      ? "No lapsed manual memberships past the grace period."
      : `Dropped ${droppedCount} member${droppedCount === 1 ? "" : "s"} to Free tier.`;
  },
};
