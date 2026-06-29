import { findAllSubscriptions, saveSubscription } from "@/lib/db";
import { isPendingCheckoutStale } from "@/lib/billing";
import type { JobDefinition } from "./types";

// A "pending" subscription whose checkout was never completed currently
// only gets unstuck reactively — the member-facing UI already lets a member
// retry once it's stale (see lib/billing.ts), but the stored status itself
// stays "pending" forever until they do. This makes that transition real
// and proactive instead of relying on someone loading the membership page.
export const expireStaleCheckoutsJob: JobDefinition = {
  name: "expire-stale-checkouts",
  description: "Flips abandoned pending checkouts to inactive once they're past the retry window.",
  async run() {
    const subscriptions = findAllSubscriptions();
    let expiredCount = 0;

    for (const subscription of subscriptions) {
      if (subscription.status !== "pending") continue;
      if (!isPendingCheckoutStale(subscription.updatedAt)) continue;

      saveSubscription({
        ...subscription,
        status: "inactive",
        updatedAt: new Date().toISOString(),
      });

      expiredCount += 1;
    }

    return expiredCount === 0
      ? "No stale pending checkouts found."
      : `Expired ${expiredCount} stale pending checkout${expiredCount === 1 ? "" : "s"}.`;
  },
};
