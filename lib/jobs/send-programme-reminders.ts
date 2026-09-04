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

// Two nudges per cycle, timed to the day-CYCLE position rather than
// calendar days — consistent with how the programme model already treats
// "a week" as one full pass through days[], not a literal 7-day span (a
// 3-day-a-week split's "week" spans more calendar days than a 6-day split's
// does). Index 1 ("2nd day") and index 4 ("5th day") of the current cycle,
// clamped to whatever the programme's day count actually allows.
const SLOT_DAY_INDEXES = [1, 4] as const;

export const sendProgrammeRemindersJob: JobDefinition = {
  name: "send-programme-reminders",
  description:
    "Sends two nudges per cycle to members on an active AI training programme, timed to their progress through the current cycle rather than calendar days.",
  async run() {
    const programs = findAllTrainingPrograms().filter(
      (p) => p.status === "active" && (p.source ?? "staff") === "ai"
    );

    let sent = 0;

    for (const program of programs) {
      const completedCycles = program.completedCycles ?? 0;
      const seenIndexes = new Set<number>();

      for (let slot = 0; slot < SLOT_DAY_INDEXES.length; slot++) {
        const targetIndex = Math.min(SLOT_DAY_INDEXES[slot], Math.max(0, program.days.length - 1));
        if (seenIndexes.has(targetIndex) || program.currentDayIndex !== targetIndex) continue;
        seenIndexes.add(targetIndex);

        const dedupeKey = `programme-reminder:${program.id}:cycle${completedCycles}:slot${slot + 1}`;
        if (findNotificationByDedupeKey(program.userId, dedupeKey)) continue;

        const profile = findProfileByUserId(program.userId);
        const notification: NotificationRecord = {
          id: randomUUID(),
          userId: program.userId,
          type: "training_reminder",
          title: "Training reminder",
          body: `Keep it going — ${program.name} is waiting for your next session.`,
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
    }

    return sent === 0 ? "No programme reminders to send at this time." : `Sent ${sent} programme reminder${sent === 1 ? "" : "s"}.`;
  },
};
