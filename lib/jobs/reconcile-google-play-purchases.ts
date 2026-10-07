import { reconcileGooglePlayPurchases } from "@/lib/iap/service";
import type { JobDefinition } from "./types";

// Re-asks Google about App Subscription purchases whose state may have drifted (a notification that never
// arrived, or a paid period that ended with nothing recording it). Bounded per run, and it stops early if the
// provider rejects our credentials. Runs whether or not the purchases kill switch is on: withdrawing access after
// an expiry or refund must never be switchable off. Does nothing when Google Play is not configured.
export const reconcileGooglePlayPurchasesJob: JobDefinition = {
  name: "reconcile-google-play-purchases",
  description: "Re-checks Google Play subscription purchases whose state may be out of date.",
  timeoutMs: 120_000,
  async run() {
    const summary = await reconcileGooglePlayPurchases();
    if (summary.skipped) return "Skipped: Google Play is not configured.";
    return `Re-checked ${summary.processed} of ${summary.considered} purchase(s); ${summary.failed} could not be checked.`;
  },
};
