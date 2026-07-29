// Transactional booking emails (confirmation + cancellation). Thin helpers over
// the shared sendEmail pipeline: they resolve the member's deliverable address,
// respect the emailNotificationsEnabled opt-out, format the class details, and
// fire-and-forget the send (sendEmail never throws, so a booking flow can never
// be broken by email). Triggered from the booking routes at confirmed events.

import {
  findProfileByUserId,
  findUserById,
  isTransactionalEmailEnabled,
  type ClassRecord,
} from "@/lib/db";
import { sendEmail } from "@/lib/email";
import {
  bookingCancellationEmail,
  bookingConfirmationEmail,
  classCancelledEmail,
} from "@/lib/email-templates";

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
  });

  void sendEmail({ to: recipient.email, ...template });
}

// Staff/gym-initiated cancellation of a whole class — distinct wording from a
// member's own cancellation. Sent per affected booked member.
export function sendClassCancelledEmail(
  userId: string,
  classRecord: ClassRecord,
  creditRestored: boolean
): void {
  if (!isTransactionalEmailEnabled("classCancelled")) return;
  const recipient = memberRecipient(userId);
  if (!recipient) return;

  const template = classCancelledEmail({
    memberName: recipient.name,
    className: classRecord.title,
    classDate: formatClassDate(classRecord.date),
    startTime: classRecord.startTime,
    creditRestored,
  });

  void sendEmail({ to: recipient.email, ...template });
}

export function sendBookingCancellationEmail(
  userId: string,
  classRecord: ClassRecord,
  creditRestored: boolean
): void {
  if (!isTransactionalEmailEnabled("bookingCancellation")) return;
  const recipient = memberRecipient(userId);
  if (!recipient) return;

  const template = bookingCancellationEmail({
    memberName: recipient.name,
    className: classRecord.title,
    classDate: formatClassDate(classRecord.date),
    startTime: classRecord.startTime,
    creditRestored,
  });

  void sendEmail({ to: recipient.email, ...template });
}
