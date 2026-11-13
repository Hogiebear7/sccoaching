import { randomUUID } from "crypto";

import {
  createNotification,
  findBookingsByClassId,
  findClassById,
  findClassWorkoutByClassId,
  findNotificationByDedupeKey,
  findProfileByUserId,
  findWorkoutSessionByUserAndClass,
  saveClassWorkout,
} from "@/lib/db";
import { syncClassWorkoutToMember } from "@/lib/class-workout-sync";
import { sendPush } from "@/lib/push";

// "Well done today" recap. When the coach has finished a class workout they send this to the people who came (checked in). Each gets a
// notification, and a push if they have push on, that opens their copy of the workout so they can change anything that was different for them,
// say how hard it felt and see their summary. It is sent at most once per person per class: saving the workout again or pressing the button
// again does not repeat it.

export type RecapResult =
  | { ok: true; sent: number; alreadySent: number; noWorkout?: never }
  | { ok: false; reason: "no_class" | "no_workout" };

export function recapDedupeKey(classId: string): string {
  return `class-recap:${classId}`;
}

export function sendClassRecap(classId: string, now: Date = new Date()): RecapResult {
  const classRecord = findClassById(classId);
  if (!classRecord) return { ok: false, reason: "no_class" };

  const template = findClassWorkoutByClassId(classId);
  if (!template) return { ok: false, reason: "no_workout" };

  let sent = 0;
  let alreadySent = 0;

  const attendees = findBookingsByClassId(classId).filter((b) => b.attendedAt !== null);
  for (const booking of attendees) {
    // Make sure they have their own copy of the workout to open (a member checked in without booking ahead may not).
    syncClassWorkoutToMember(classId, booking.userId);
    const session = findWorkoutSessionByUserAndClass(booking.userId, classId);
    if (!session) continue;

    const dedupeKey = recapDedupeKey(classId);
    if (findNotificationByDedupeKey(booking.userId, dedupeKey)) {
      alreadySent += 1;
      continue;
    }

    const title = "Well done today";
    const body = `Thanks for joining us today. Your ${classRecord.title} workout is ready. Have a look, change anything that was different for you and tell us how it felt.`;
    const linkHref = `/dashboard/workouts/class/${session.id}`;

    createNotification({
      id: randomUUID(),
      userId: booking.userId,
      type: "class_recap",
      title,
      body,
      readAt: null,
      linkHref,
      dedupeKey,
      createdAt: now.toISOString(),
    });
    if (findProfileByUserId(booking.userId)?.pushNotificationsEnabled !== false) {
      void sendPush(booking.userId, { title, body, linkHref });
    }
    sent += 1;
  }

  if (sent > 0 || !template.recapSentAt) {
    saveClassWorkout({ ...template, recapSentAt: template.recapSentAt ?? now.toISOString() });
  }
  return { ok: true, sent, alreadySent };
}
