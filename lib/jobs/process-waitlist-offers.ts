import { randomUUID } from "crypto";

import { classStartMs } from "@/lib/class-time";
import {
  createNotification,
  findAllWaitlistEntries,
  findClassById,
  findNotificationByDedupeKey,
  findProfileByUserId,
  findUserById,
  saveWaitlistEntry,
  type NotificationRecord,
} from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { waitlistTimeoutEmail } from "@/lib/email-templates";
import { sendPush } from "@/lib/push";
import { computeOfferWindowMs, issueWaitlistOffer } from "@/lib/scheduling";
import type { JobDefinition } from "./types";

export const processWaitlistOffersJob: JobDefinition = {
  name: "process-waitlist-offers",
  description:
    "Expires overdue waitlist offers, cascades to the next eligible member, and sends window-narrowing warnings when the class draws closer.",
  async run() {
    const now = Date.now();
    const nowIso = new Date().toISOString();

    const allEntries = findAllWaitlistEntries();
    const offeredEntries = allEntries.filter((e) => e.offerState === "offered");

    // Track how many times to cascade per class (one call per expired offer).
    const expiredByClass = new Map<string, number>();
    let expiredCount = 0;
    let narrowedCount = 0;

    for (const entry of offeredEntries) {
      const classRecord = findClassById(entry.classId);

      if (!classRecord) {
        // Orphaned entry — expire it, no cascade needed.
        saveWaitlistEntry({ ...entry, offerState: "expired", resolvedAt: nowIso });
        expiredCount++;
        continue;
      }

      const classMs = classStartMs(classRecord.date, classRecord.startTime);

      // Class has already started — expire without cascading.
      if (classMs <= now) {
        saveWaitlistEntry({ ...entry, offerState: "expired", resolvedAt: nowIso });
        expiredCount++;
        continue;
      }

      // Offer window elapsed — expire and schedule a cascade.
      if (entry.offerExpiresAt && entry.offerExpiresAt <= nowIso) {
        saveWaitlistEntry({ ...entry, offerState: "expired", resolvedAt: nowIso });
        expiredCount++;
        expiredByClass.set(entry.classId, (expiredByClass.get(entry.classId) ?? 0) + 1);
        continue;
      }

      // Window-narrowing: if the class is now closer than when the offer was
      // issued, the allowable window is shorter. Shorten the expiry (never
      // extend it) and send exactly one warning notification per offer.
      if (entry.warningNotifiedAt === null) {
        const allowableWindowMs = computeOfferWindowMs(classMs, now);
        const currentExpiryMs = entry.offerExpiresAt
          ? new Date(entry.offerExpiresAt).getTime()
          : Infinity;
        const newExpiryMs = now + allowableWindowMs;

        if (newExpiryMs < currentExpiryMs) {
          const newExpiryIso = new Date(newExpiryMs).toISOString();

          saveWaitlistEntry({
            ...entry,
            offerExpiresAt: newExpiryIso,
            warningNotifiedAt: nowIso,
          });

          const dedupeKey = `waitlist-timeout:${entry.id}`;
          if (!findNotificationByDedupeKey(entry.userId, dedupeKey)) {
            const classDateLabel = new Date(classRecord.date).toLocaleDateString("en-IE", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const newExpiryTime = new Date(newExpiryMs).toLocaleTimeString("en-IE", {
              hour: "2-digit",
              minute: "2-digit",
            });

            const notification: NotificationRecord = {
              id: randomUUID(),
              userId: entry.userId,
              type: "waitlist_timeout",
              title: `Offer expiring soon: ${classRecord.title}`,
              body: `Your spot offer for ${classRecord.title} on ${classDateLabel} is about to expire — accept by ${newExpiryTime} or it passes to the next person.`,
              readAt: null,
              linkHref: "/dashboard/schedule",
              dedupeKey,
              createdAt: nowIso,
            };

            try {
              createNotification(notification);

              const memberUser = findUserById(entry.userId);
              const memberProfile = findProfileByUserId(entry.userId);
              if (memberProfile?.emailNotificationsEnabled !== false && memberUser?.email) {
                const tmpl = waitlistTimeoutEmail({
                  memberName: memberProfile?.fullName || memberUser.email,
                  className: classRecord.title,
                  classDate: classDateLabel,
                  expiryTime: newExpiryTime,
                });
                void sendEmail({ to: memberUser.email, ...tmpl });
              }
              if (memberProfile?.pushNotificationsEnabled !== false) {
                void sendPush(entry.userId, {
                  title: notification.title,
                  body: notification.body,
                  linkHref: notification.linkHref ?? "/dashboard/schedule",
                });
              }
            } catch {
              // Notification failure must never block offer processing.
            }
          }

          narrowedCount++;
        }
      }
    }

    // Cascade for each expired offer: one issueWaitlistOffer call per expired slot.
    for (const [classId, count] of expiredByClass) {
      for (let i = 0; i < count; i++) {
        try {
          issueWaitlistOffer(classId);
        } catch {
          // Cascade failure is non-fatal.
        }
      }
    }

    const parts: string[] = [];
    if (expiredCount > 0)
      parts.push(`${expiredCount} offer${expiredCount === 1 ? "" : "s"} expired and cascaded`);
    if (narrowedCount > 0)
      parts.push(`${narrowedCount} offer window${narrowedCount === 1 ? "" : "s"} narrowed`);

    return parts.length === 0
      ? "No waitlist offer actions needed."
      : parts.join("; ") + ".";
  },
};
