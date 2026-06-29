import { randomUUID } from "crypto";

import {
  findAllSubscriptions,
  findAnyStaffUser,
  findMembershipPlanById,
  createMessage,
  saveSubscription,
} from "@/lib/db";
import { formatMembershipDate, isPeriodLapsed } from "@/lib/membership-status";
import type { JobDefinition } from "./types";

// A member's billing period lapsing is currently only ever surfaced when
// someone happens to load a page that computes isPeriodLapsed() — nothing
// proactively tells the member. This job finds newly-lapsed active
// subscriptions and sends one notification each, marking them so the same
// lapse is never re-announced on a later run.
export const notifyLapsedMembershipsJob: JobDefinition = {
  name: "notify-lapsed-memberships",
  description: "Messages members the first time their active billing period is found to have lapsed.",
  async run() {
    const subscriptions = findAllSubscriptions();
    const staffSender = findAnyStaffUser();

    if (!staffSender) {
      return "Skipped: no staff account exists to send notifications from.";
    }

    let notifiedCount = 0;

    for (const subscription of subscriptions) {
      if (subscription.periodLapsedNotifiedAt !== null) continue;
      if (!isPeriodLapsed(subscription)) continue;

      const plan = subscription.planId ? findMembershipPlanById(subscription.planId) : undefined;
      const now = new Date().toISOString();

      createMessage({
        id: randomUUID(),
        memberId: subscription.userId,
        senderId: staffSender.id,
        senderRole: "staff",
        body: plan
          ? `Your ${plan.name} billing period ended on ${formatMembershipDate(subscription.currentPeriodEnd!)}. Select your plan again on the Membership page to keep booking classes.`
          : "Your billing period has ended. Select your plan again on the Membership page to keep booking classes.",
        createdAt: now,
      });

      saveSubscription({
        ...subscription,
        periodLapsedNotifiedAt: now,
        updatedAt: now,
      });

      notifiedCount += 1;
    }

    return notifiedCount === 0
      ? "No newly-lapsed memberships to notify."
      : `Notified ${notifiedCount} member${notifiedCount === 1 ? "" : "s"} about a lapsed billing period.`;
  },
};
