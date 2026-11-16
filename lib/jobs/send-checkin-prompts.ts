import { randomUUID } from "crypto";

import {
  createNotification,
  findAllBookings,
  findClassById,
  findNotificationByDedupeKey,
  findProfileByUserId,
  findRecoveryLogByUserIdAndDate,
  type NotificationRecord,
} from "@/lib/db";
import { checkinPromptDue } from "@/lib/checkin-prompt";
import { classStartMs } from "@/lib/class-time";
import { sendPush } from "@/lib/push";
import type { JobDefinition } from "./types";

export const sendCheckinPromptsJob: JobDefinition = {
  name: "send-checkin-prompts",
  description:
    "About an hour before a booked class, nudges a member who has not done today's check-in yet to do it, so the coach's brief has their readiness. One prompt per booking. Push and in-app, respecting the member's push setting.",
  async run() {
    const now = Date.now();
    let sent = 0;

    for (const booking of findAllBookings()) {
      const cls = findClassById(booking.classId);
      if (!cls) continue;
      const classMs = classStartMs(cls.date, cls.startTime);
      const due = checkinPromptDue({
        nowMs: now,
        classMs,
        alreadyCheckedIn: !!findRecoveryLogByUserIdAndDate(booking.userId, cls.date),
        alreadyAttended: !!booking.attendedAt,
      });
      if (!due) continue;

      const dedupeKey = `booking:${booking.id}:checkin-prompt`;
      if (findNotificationByDedupeKey(booking.userId, dedupeKey)) continue;

      const notification: NotificationRecord = {
        id: randomUUID(),
        userId: booking.userId,
        type: "class_reminder",
        title: "Quick check-in before class?",
        body: `You're booked into ${cls.title} at ${cls.startTime}. A 30-second check-in tells your coach how you're feeling today.`,
        readAt: null,
        linkHref: "/dashboard/recovery",
        dedupeKey,
        createdAt: new Date().toISOString(),
      };
      createNotification(notification);

      if (findProfileByUserId(booking.userId)?.pushNotificationsEnabled !== false) {
        void sendPush(booking.userId, { title: notification.title, body: notification.body, linkHref: notification.linkHref ?? "/dashboard/recovery" });
      }
      sent += 1;
    }

    return sent === 0 ? "No check-in prompts to send at this time." : `Sent ${sent} check-in prompt${sent === 1 ? "" : "s"}.`;
  },
};
