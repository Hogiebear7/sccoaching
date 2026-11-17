// The one place that decides whether an optional or journey email may go, and sends it through lib/email.ts (so suppression, the send log and the
// once-only key all apply). Everything here is OFF unless COMMS_ENABLED=true, and journeys only start for members who joined after COMMS_JOURNEYS_FROM
// (an ISO date), so switching on never emails existing members out of the blue.
import { getConfiguredAppUrl } from "@/lib/app-config";
import { findProfileByUserId, findUserById } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { journeyEmail, membershipEndedEmail, paymentFailedEmail } from "@/lib/comms-copy";
import { effectivePrefs, unsubscribeToken } from "@/lib/comms-prefs";
import { parqRequired } from "@/lib/parq";

export function commsEnabled(): boolean {
  return process.env.COMMS_ENABLED === "true";
}

/** Members who joined on or after this date may get getting-started emails. Unset means nobody does. */
export function journeysFrom(): string | null {
  const v = process.env.COMMS_JOURNEYS_FROM?.trim();
  return v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
}

const baseUrl = () => (getConfiguredAppUrl() || "http://localhost:3000").replace(/\/$/, "");

export function unsubscribeUrl(userId: string, topic: "tips" | "marketing" | "all"): string {
  return `${baseUrl()}/unsubscribe?t=${unsubscribeToken(userId, topic)}`;
}

/** Headers that let a mail app show its own Unsubscribe button (RFC 8058 one-click). */
export function unsubscribeHeaders(userId: string, topic: "tips" | "marketing"): Record<string, string> {
  const token = unsubscribeToken(userId, topic);
  return {
    "List-Unsubscribe": `<${baseUrl()}/api/unsubscribe?t=${token}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Sends one getting-started step to a member. Returns why it was skipped, or "sent". Skips: comms off, no address, the member switched emails off, or
 * unsubscribed from tips. The once-only key means a repeat run never sends it twice.
 */
export async function sendJourneyStep(userId: string, stepId: string): Promise<string> {
  if (!commsEnabled()) return "comms off";
  const user = findUserById(userId);
  const profile = findProfileByUserId(userId);
  if (!user || user.archivedAt || !profile?.email) return "no address";
  if (profile.emailNotificationsEnabled === false) return "emails switched off";
  if (!effectivePrefs(profile.emailPrefs).tips) return "unsubscribed from tips";

  const built = journeyEmail(stepId, {
    name: profile.fullName || "",
    unsubscribeUrl: unsubscribeUrl(userId, "tips"),
    parqOn: parqRequired(),
  });
  if (!built) return "unknown step";
  await sendEmail({
    to: profile.email,
    ...built,
    headers: unsubscribeHeaders(userId, "tips"),
    kind: `journey:${stepId}`,
    dedupeKey: `journey:${stepId}:${userId}`,
  });
  return "sent";
}

// ── Payment emails, from the Stripe webhook. Service messages about the member's own payment, so no unsubscribe. ──
async function sendPaymentEmail(userId: string, build: (name: string) => ReturnType<typeof paymentFailedEmail>, kind: string, dedupeKey: string): Promise<void> {
  if (!commsEnabled()) return;
  const user = findUserById(userId);
  const profile = findProfileByUserId(userId);
  if (!user || user.archivedAt || !profile?.email) return;
  await sendEmail({ to: profile.email, ...build(profile.fullName || ""), kind, dedupeKey });
}

export const sendPaymentFailedEmail = (userId: string, eventId: string) => sendPaymentEmail(userId, paymentFailedEmail, "payment-failed", `payment-failed:${eventId}`);
export const sendMembershipEndedEmail = (userId: string, eventId: string) => sendPaymentEmail(userId, membershipEndedEmail, "membership-ended", `membership-ended:${eventId}`);
