import { findAllSubscriptions, saveSubscription } from "@/lib/db";
import { isPendingCheckoutStale } from "@/lib/billing";
import { parkAbandonedCheckout } from "@/lib/checkout-recovery";
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
    let clearedSwitches = 0;

    for (const subscription of subscriptions) {
      // Abandoned SWITCH: the member's active membership is untouched, but a
      // stale in-flight switch left its pending fields set. Move them out of the pending fields so the record is tidy
      // (entitlement was never affected), but PARK the checkout in abandonedCheckouts instead of discarding it: a Stripe
      // session stays payable for up to 24 hours, and a late payment must still be reconcilable (lib/checkout-recovery.ts).
      // Idempotent: one parked entry per session id. Done before the pending-status check because a switch keeps status "active".
      if (
        subscription.pendingSetupOrderId &&
        subscription.pendingStartedAt &&
        isPendingCheckoutStale(subscription.pendingStartedAt)
      ) {
        const now = new Date().toISOString();
        saveSubscription({
          ...subscription,
          pendingPackageId: null,
          pendingBillingOptionId: null,
          pendingSetupOrderId: null,
          pendingStartedAt: null,
          abandonedCheckouts: parkAbandonedCheckout(subscription.abandonedCheckouts, {
            sessionId: subscription.pendingSetupOrderId,
            packageId: subscription.pendingPackageId ?? null,
            billingOptionId: subscription.pendingBillingOptionId ?? null,
            startedAt: subscription.pendingStartedAt,
            clearedAt: now,
            // A parked intent on a Play-billed row was a Stripe checkout displaced by the Play purchase.
            reason: subscription.provider === "google_play" ? "replaced_by_play" : "stale_switch",
          }),
          updatedAt: now,
        });
        clearedSwitches += 1;
        continue;
      }

      if (subscription.status !== "pending") continue;
      if (!isPendingCheckoutStale(subscription.updatedAt)) continue;

      saveSubscription({
        ...subscription,
        status: "inactive",
        updatedAt: new Date().toISOString(),
      });

      expiredCount += 1;
    }

    const parts: string[] = [];
    if (expiredCount > 0) parts.push(`Expired ${expiredCount} stale pending checkout${expiredCount === 1 ? "" : "s"}.`);
    if (clearedSwitches > 0) parts.push(`Cleared ${clearedSwitches} abandoned switch${clearedSwitches === 1 ? "" : "es"} (parked for late-payment recovery).`);
    return parts.length > 0 ? parts.join(" ") : "No stale pending checkouts found.";
  },
};
