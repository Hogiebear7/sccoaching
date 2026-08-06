import { findAllSubscriptions, saveSubscription } from "@/lib/db";
import type { JobDefinition } from "./types";

// Flips a paused membership back to its pre-pause status once pausedUntil
// has passed. Stripe billing itself resumes on its own timer (resumes_at
// set when the pause was created) — this job only needs to catch up OUR
// local status so booking/benefit gates (which key off subscription.status)
// stop blocking the member again.
export const resumePausedMembershipsJob: JobDefinition = {
  name: "resume-paused-memberships",
  description: "Resumes memberships whose pause period has ended.",
  async run() {
    const now = Date.now();
    const nowIso = new Date().toISOString();
    let resumedCount = 0;

    for (const subscription of findAllSubscriptions()) {
      if (subscription.status !== "paused" || !subscription.pausedUntil) continue;
      if (new Date(subscription.pausedUntil).getTime() > now) continue;

      saveSubscription({
        ...subscription,
        status: subscription.statusBeforePause ?? "active",
        statusBeforePause: null,
        pausedUntil: null,
        updatedAt: nowIso,
      });
      resumedCount++;
    }

    return resumedCount === 0
      ? "No paused memberships were due to resume."
      : `Resumed ${resumedCount} membership${resumedCount === 1 ? "" : "s"}.`;
  },
};
