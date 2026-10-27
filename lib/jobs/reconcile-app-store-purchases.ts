import { reconcileAppStorePurchases } from "@/lib/iap/apple-service";
import type { JobDefinition } from "./types";

// Re-asks Apple about digital-plan subscriptions whose state may have drifted (a notification that never arrived, or a paid
// period that ended with nothing recording it). Bounded per run, and it stops early if Apple rejects our credentials. Runs
// whether or not the purchases kill switch is on: withdrawing access after an expiry or refund must never be switchable off.
// Does nothing when the App Store is not configured.
export const reconcileAppStorePurchasesJob: JobDefinition = {
  name: "reconcile-app-store-purchases",
  description: "Re-checks App Store subscriptions whose state may be out of date.",
  timeoutMs: 120_000,
  async run() {
    const summary = await reconcileAppStorePurchases();
    if (summary.skipped) return "Skipped: the App Store is not configured.";
    return `Re-checked ${summary.processed} of ${summary.considered} subscription(s); ${summary.failed} could not be checked.`;
  },
};
