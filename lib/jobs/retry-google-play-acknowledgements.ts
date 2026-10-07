import { retryGooglePlayAcknowledgements } from "@/lib/iap/service";
import type { JobDefinition } from "./types";

// Retries acknowledging entitled Google Play purchases that are still unacknowledged. Google refunds a purchase
// that is not acknowledged within three days, so each purchase gets a minimum interval between attempts, an
// attempt cap, and no attempts once the window has passed. Runs whether or not the kill switch is on.
export const retryGooglePlayAcknowledgementsJob: JobDefinition = {
  name: "retry-google-play-acknowledgements",
  description: "Retries acknowledging Google Play purchases that are still unacknowledged.",
  timeoutMs: 120_000,
  async run() {
    const summary = await retryGooglePlayAcknowledgements();
    if (summary.skipped) return "Skipped: Google Play is not configured.";
    return `Acknowledged ${summary.processed} of ${summary.considered} purchase(s); ${summary.failed} failed and will be retried.`;
  },
};
