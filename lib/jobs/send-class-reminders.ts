import { randomUUID } from "crypto";

import {
  findAllBookings,
  findClassById,
  findProfileByUserId,
  findNotificationByDedupeKey,
  createNotification,
  isTransactionalEmailEnabled,
  type NotificationRecord,
} from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { classReminderEmail } from "@/lib/email-templates";
import { sendPush } from "@/lib/push";
import type { JobDefinition } from "./types";

const DEFAULT_REMINDER_TIMINGS_MINS = [1440, 360, 180, 60];

// Notifications older than this threshold relative to their target send time
// are considered stale and skipped. Prevents late-delivery spam when the job
// runs infrequently and multiple reminder windows have already passed.
const MAX_STALE_MS = 4 * 60 * 60 * 1000; // 4 hours

function classDateTimeMs(date: string, startTime: string): number {
  const [h, m] = startTime.split(":").map(Number);
  const dt = new Date(date);
  dt.setHours(h, m, 0, 0);
  return dt.getTime();
}

export const sendClassRemindersJob: JobDefinition = {
  name: "send-class-reminders",
  description:
    "Sends in-app notifications ahead of booked classes based on each member's reminder timing preferences.",
  async run() {
    const now = Date.now();
    // Read the optional-email toggle once; it gates ONLY the reminder email —
    // in-app notifications and push are unaffected.
    const reminderEmailEnabled = isTransactionalEmailEnabled("classReminder");
    const bookings = findAllBookings();

    // Only process upcoming bookings (class hasn't started yet)
    const upcomingBookings = bookings.filter((b) => {
      const cls = findClassById(b.classId);
      if (!cls) return false;
      return classDateTimeMs(cls.date, cls.startTime) > now;
    });

    let sent = 0;

    for (const booking of upcomingBookings) {
      const cls = findClassById(booking.classId);
      if (!cls) continue;

      const classMs = classDateTimeMs(cls.date, cls.startTime);
      const profile = findProfileByUserId(booking.userId);
      const effectiveTimings =
        profile?.reminderTimingsMins ?? DEFAULT_REMINDER_TIMINGS_MINS;

      for (const timingMins of effectiveTimings) {
        const targetMs = classMs - timingMins * 60_000;

        // Not yet time to send this reminder
        if (now < targetMs) continue;

        // Missed the send window — too stale to be useful
        if (now - targetMs > MAX_STALE_MS) continue;

        const dedupeKey = `booking:${booking.id}:reminder:${timingMins}m`;

        if (findNotificationByDedupeKey(booking.userId, dedupeKey)) continue;

        const classDate = new Date(cls.date).toLocaleDateString("en-IE", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });

        const leadLabel =
          timingMins >= 60 && timingMins % 60 === 0
            ? `${timingMins / 60} hour${timingMins / 60 === 1 ? "" : "s"}`
            : timingMins >= 60
            ? `${Math.floor(timingMins / 60)}h ${timingMins % 60}m`
            : `${timingMins} minutes`;

        const notification: NotificationRecord = {
          id: randomUUID(),
          userId: booking.userId,
          type: "class_reminder",
          title: `Class reminder: ${cls.title}`,
          body: `Your ${cls.title} class starts in ${leadLabel} — ${classDate} at ${cls.startTime}.`,
          readAt: null,
          linkHref: "/dashboard/bookings",
          dedupeKey,
          createdAt: new Date().toISOString(),
        };

        createNotification(notification);

        if (reminderEmailEnabled && profile?.emailNotificationsEnabled !== false && profile?.email) {
          const tmpl = classReminderEmail({
            memberName: profile.fullName || profile.email,
            className: cls.title,
            classDate,
            startTime: cls.startTime,
            leadLabel,
          });
          void sendEmail({ to: profile.email, ...tmpl });
        }
        if (profile?.pushNotificationsEnabled !== false) {
          void sendPush(booking.userId, {
            title: notification.title,
            body: notification.body,
            linkHref: notification.linkHref ?? "/dashboard/bookings",
          });
        }

        sent += 1;
      }
    }

    return sent === 0
      ? "No class reminders to send at this time."
      : `Sent ${sent} class reminder${sent === 1 ? "" : "s"}.`;
  },
};
