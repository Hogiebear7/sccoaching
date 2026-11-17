import { findMembers, findProfileByUserId, findSubscriptionByUserId, hasEmailSend } from "@/lib/db";
import { commsEnabled, journeysFrom, sendJourneyStep } from "@/lib/comms";
import { journeyFor, nextDueStep, stepsFor } from "@/lib/comms-journeys";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import type { JobDefinition } from "./types";

// Sends the next getting-started email to each member who is due one (lib/comms-journeys.ts). Off unless COMMS_ENABLED=true. An app-only member's journey
// starts the day they signed up; a gym member's starts when their gym membership was created, and a gym membership always replaces the app journey.
// Only members who joined on or after COMMS_JOURNEYS_FROM are considered, so turning this on never emails existing members.
export const sendJourneyEmailsJob: JobDefinition = {
  name: "send-journey-emails",
  description: "Sends the next welcome / getting-started email to members who are due one.",
  async run() {
    if (!commsEnabled()) return "Comms are off (COMMS_ENABLED is not true); nothing sent.";
    const from = journeysFrom();
    if (!from) return "COMMS_JOURNEYS_FROM is not set; nothing sent.";

    const now = new Date();
    let sent = 0;
    let considered = 0;
    for (const user of findMembers()) {
      if (user.role !== "member" || user.archivedAt) continue;
      const access = resolveMemberAccessForUser(user.id, now.getTime());
      const journey = journeyFor(access);
      const subscription = journey === "gym" ? findSubscriptionByUserId(user.id) : undefined;
      const startedAt = journey === "gym" ? subscription?.createdAt : user.createdAt;
      if (!startedAt || startedAt < from) continue;
      if (!findProfileByUserId(user.id)?.email) continue;
      considered++;

      const sentIds = new Set(stepsFor(journey).filter((s) => hasEmailSend(`journey:${s.id}:${user.id}`)).map((s) => s.id));
      const step = nextDueStep({ journey, startedAtISO: startedAt, now, sent: sentIds });
      if (!step) continue;
      if ((await sendJourneyStep(user.id, step.id)) === "sent") sent++;
    }
    return `Considered ${considered} member${considered === 1 ? "" : "s"}; sent ${sent} email${sent === 1 ? "" : "s"}.`;
  },
};
