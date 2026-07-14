import { randomUUID } from "crypto";

import {
  createNotification,
  findMembers,
  findNotificationByDedupeKey,
} from "@/lib/db";
import { formatMembershipDate } from "@/lib/membership-status";
import { expiringPassSummary } from "@/lib/payments";
import type { JobDefinition } from "./types";

// Purchased passes with a use-by date currently just stop working when they
// lapse — nothing warns the member beforehand. This gives them a heads-up
// while there is still time to book. One notification per expiry batch: the
// dedupe key carries the expiry date, so the same batch is never
// re-announced on later runs, while a future purchase with a new use-by
// date gets its own notice.
const WARN_WITHIN_DAYS = 7;

export const notifyExpiringPassesJob: JobDefinition = {
  name: "notify-expiring-passes",
  description: "Warns members once when purchased passes are within a week of their use-by date.",
  async run() {
    let notifiedCount = 0;

    for (const member of findMembers()) {
      if (member.archivedAt) continue;

      const expiring = expiringPassSummary(member.id, WARN_WITHIN_DAYS);
      if (!expiring) continue;

      const expiryDay = expiring.soonestExpiresAt.slice(0, 10);
      const dedupeKey = `pass-expiry:${expiryDay}`;
      if (findNotificationByDedupeKey(member.id, dedupeKey)) continue;

      createNotification({
        id: randomUUID(),
        userId: member.id,
        type: "membership",
        title: `${expiring.count} class pass${expiring.count === 1 ? "" : "es"} expiring soon`,
        body: `You have ${expiring.count} purchased pass${expiring.count === 1 ? "" : "es"} that must be used by ${formatMembershipDate(expiring.soonestExpiresAt)}. Book a session to use ${expiring.count === 1 ? "it" : "them"} in time.`,
        readAt: null,
        linkHref: "/dashboard/schedule",
        dedupeKey,
        createdAt: new Date().toISOString(),
      });

      notifiedCount += 1;
    }

    return notifiedCount === 0
      ? "No members with passes expiring soon."
      : `Warned ${notifiedCount} member${notifiedCount === 1 ? "" : "s"} about passes nearing their use-by date.`;
  },
};
