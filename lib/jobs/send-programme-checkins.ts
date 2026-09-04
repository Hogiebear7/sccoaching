import { randomUUID } from "crypto";

import {
  createNotification,
  findAllTrainingPrograms,
  findNotificationByDedupeKey,
  findProfileByUserId,
  type NotificationRecord,
} from "@/lib/db";
import { sendPush } from "@/lib/push";
import type { JobDefinition } from "./types";

// Fires once per completed cycle — no AI call here (that happens lazily
// when the member actually opens the check-in, see generateProgrammeCheckIn
// in lib/ai.ts). The dedupe key alone makes this idempotent: it only exists
// once completedCycles has genuinely incremented, so re-running this job on
// the shared 15-minute tick never double-sends for the same cycle.
export const sendProgrammeCheckinsJob: JobDefinition = {
  name: "send-programme-checkins",
  description:
    "Notifies a member once their current AI training programme cycle wraps that their end-of-week check-in is ready to open.",
  async run() {
    const programs = findAllTrainingPrograms().filter(
      (p) => p.status === "active" && (p.source ?? "staff") === "ai" && (p.completedCycles ?? 0) > 0
    );

    let sent = 0;

    for (const program of programs) {
      const justCompletedCycleIndex = (program.completedCycles ?? 0) - 1;
      const dedupeKey = `programme-checkin:${program.id}:cycle${justCompletedCycleIndex}`;
      if (findNotificationByDedupeKey(program.userId, dedupeKey)) continue;

      const profile = findProfileByUserId(program.userId);
      const notification: NotificationRecord = {
        id: randomUUID(),
        userId: program.userId,
        type: "training_checkin",
        title: "Your check-in is ready",
        body: `Week ${justCompletedCycleIndex + 1} of ${program.name} is done — see how it went.`,
        readAt: null,
        linkHref: "/dashboard/programme",
        dedupeKey,
        createdAt: new Date().toISOString(),
      };

      createNotification(notification);

      if (profile?.pushNotificationsEnabled !== false) {
        void sendPush(program.userId, {
          title: notification.title,
          body: notification.body,
          linkHref: notification.linkHref ?? "/dashboard/programme",
        });
      }

      sent += 1;
    }

    return sent === 0 ? "No programme check-ins to send at this time." : `Sent ${sent} programme check-in${sent === 1 ? "" : "s"}.`;
  },
};
