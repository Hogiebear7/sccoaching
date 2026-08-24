// Transactional booking confirmation email. A thin helper over the shared
// sendEmail pipeline: resolves the member's deliverable address, respects the
// emailNotificationsEnabled opt-out, formats the class details, and
// fire-and-forgets the send (sendEmail never throws, so a booking flow can
// never be broken by email). Triggered from the booking routes at confirmed
// events.
//
// Booking cancellation and gym-cancelled-class notices are push-only by
// policy — see sendPush calls in app/api/bookings/cancel/route.ts and
// app/api/staff/classes/delete/route.ts. Their email templates
// (bookingCancellationEmail, classCancelledEmail) still exist in
// lib/email-templates.ts in case that policy changes back.

import {
  findProfileByUserId,
  findUserById,
  isTransactionalEmailEnabled,
  type ClassRecord,
} from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { bookingConfirmationEmail } from "@/lib/email-templates";
import { buildClassIcsEvent } from "@/lib/ics";
import { getCancellationCutoffHours } from "@/lib/scheduling";

const GYM_LOCATION = "S&C Performance Coaching, Navan, Co. Meath";

function formatClassDate(date: string): string {
  return new Date(date).toLocaleDateString("en-IE", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function resolveCoachName(coachUserId: string): string | null {
  const coachProfile = findProfileByUserId(coachUserId);
  if (coachProfile?.fullName) return coachProfile.fullName;
  return findUserById(coachUserId)?.email ?? null;
}

// The member's deliverable address + display name, or null when email is
// opted out or no address is on file — the single gate for all booking emails.
function memberRecipient(userId: string): { email: string; name: string } | null {
  const profile = findProfileByUserId(userId);
  if (!profile || profile.emailNotificationsEnabled === false || !profile.email) return null;
  return { email: profile.email, name: profile.fullName || profile.email };
}

export function sendBookingConfirmationEmail(userId: string, classRecord: ClassRecord): void {
  if (!isTransactionalEmailEnabled("bookingConfirmation")) return;
  const recipient = memberRecipient(userId);
  if (!recipient) return;

  const template = bookingConfirmationEmail({
    memberName: recipient.name,
    className: classRecord.title,
    classDate: formatClassDate(classRecord.date),
    startTime: classRecord.startTime,
    durationLabel: `${classRecord.durationMins} min`,
    coachName: resolveCoachName(classRecord.coachUserId),
    cancellationCutoffHours: getCancellationCutoffHours(),
  });

  const ics = buildClassIcsEvent({
    uid: `${classRecord.id}-${userId}@sandccoaching.com`,
    title: classRecord.title,
    date: classRecord.date,
    startTime: classRecord.startTime,
    durationMins: classRecord.durationMins,
    location: GYM_LOCATION,
  });

  void sendEmail({
    to: recipient.email,
    ...template,
    attachments: [
      { filename: "class.ics", content: Buffer.from(ics, "utf8").toString("base64") },
    ],
  });
}

