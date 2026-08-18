import { randomUUID } from "crypto";

import {
  createNoShow,
  createNotification,
  findAllBookings,
  findClassById,
  findNoShowsByUserId,
  findNotificationByDedupeKey,
  findProfileByUserId,
  findWatchlistEntryByUserAndMonth,
  isTransactionalEmailEnabled,
  markBookingNoShowProcessed,
  saveWatchlistEntry,
  type NotificationRecord,
  type WatchlistEntryRecord,
} from "@/lib/db";
import { classStartMs } from "@/lib/class-time";
import { sendEmail } from "@/lib/email";
import { noShowEmail, ordinal } from "@/lib/email-templates";
import { sendPush } from "@/lib/push";
import type { JobDefinition } from "./types";

// Staff can check a member in any time up to (and a little after) class
// end, so a booking can't be judged a no-show until that window has fully
// closed — this hour of grace is the spec's own "an hour after the class
// ended" rule, not just a buffer against clock skew.
const GRACE_MS = 60 * 60 * 1000;

// Bounds how far back the job looks so a long gap between runs doesn't walk
// the entire booking history — markBookingNoShowProcessed already makes a
// re-run a no-op for anything already handled; this just caps scan size.
// Bookings older than this are marked processed without notifying, since a
// "sorry we missed you" email for a class from weeks ago isn't useful.
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

function monthKeyForDate(dateIso: string): string {
  return dateIso.slice(0, 7); // "YYYY-MM" — calendar month, not billing cycle.
}

export const detectNoShowsJob: JobDefinition = {
  name: "detect-no-shows",
  description:
    "Flags bookings nobody checked in for, an hour after class end. Notifies the member, and adds them to the staff-only watchlist on their second miss within the calendar month.",
  async run() {
    const now = Date.now();
    const emailEnabled = isTransactionalEmailEnabled("noShow");
    const bookings = findAllBookings();

    let flagged = 0;

    for (const booking of bookings) {
      if (booking.attendedAt !== null) continue;
      if (booking.noShowProcessedAt !== null) continue;

      const cls = findClassById(booking.classId);
      if (!cls) continue;

      const endMs = classStartMs(cls.date, cls.startTime) + cls.durationMins * 60_000;
      if (now < endMs + GRACE_MS) continue;

      if (now - endMs > LOOKBACK_MS) {
        markBookingNoShowProcessed(booking.id);
        continue;
      }

      markBookingNoShowProcessed(booking.id);

      const monthKey = monthKeyForDate(cls.date);
      const missNumber = findNoShowsByUserId(booking.userId).filter((n) => n.monthKey === monthKey).length + 1;

      createNoShow({
        id: randomUUID(),
        classId: cls.id,
        userId: booking.userId,
        classTitle: cls.title,
        classDate: cls.date,
        monthKey,
        createdAt: new Date().toISOString(),
      });

      // Only created on the miss that first crosses the threshold — see
      // WatchlistEntryRecord's doc comment for why this is transition-based
      // rather than recomputed from the live count every run.
      if (missNumber === 2 && !findWatchlistEntryByUserAndMonth(booking.userId, monthKey)) {
        const entry: WatchlistEntryRecord = {
          id: randomUUID(),
          userId: booking.userId,
          monthKey,
          missCount: missNumber,
          addedAt: new Date().toISOString(),
        };
        saveWatchlistEntry(entry);
      }

      const dedupeKey = `noshow:${booking.id}`;
      if (findNotificationByDedupeKey(booking.userId, dedupeKey)) continue;

      const profile = findProfileByUserId(booking.userId);
      const memberName = profile?.fullName || profile?.email || "there";

      const body =
        missNumber >= 2
          ? `Sorry we missed you for today's "${cls.title}" class! We understand things can happen last minute, but if you could cancel your booking in future, that would be greatly appreciated. This is your ${ordinal(
              missNumber
            )} missed class this month — if you miss a third, your membership may be at risk of suspension.`
          : `Sorry we missed you for today's "${cls.title}" class! We understand things can happen last minute, but if you could cancel your booking in future, that would be greatly appreciated. Please note: missing 3 classes in a calendar month may put your membership at risk.`;

      const notification: NotificationRecord = {
        id: randomUUID(),
        userId: booking.userId,
        type: "no_show",
        title: "We missed you today",
        body,
        readAt: null,
        linkHref: "/dashboard/bookings",
        dedupeKey,
        createdAt: new Date().toISOString(),
      };
      createNotification(notification);

      if (emailEnabled && profile?.emailNotificationsEnabled !== false && profile?.email) {
        const tmpl = noShowEmail({ memberName, className: cls.title, missNumber });
        void sendEmail({ to: profile.email, ...tmpl });
      }
      if (profile?.pushNotificationsEnabled !== false) {
        void sendPush(booking.userId, {
          title: notification.title,
          body: notification.body,
          linkHref: notification.linkHref ?? "/dashboard/bookings",
        });
      }

      flagged += 1;
    }

    return flagged === 0 ? "No new no-shows detected." : `Flagged ${flagged} no-show${flagged === 1 ? "" : "s"}.`;
  },
};
