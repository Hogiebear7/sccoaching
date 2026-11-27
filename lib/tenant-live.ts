// The go-live gate: a new gym can set everything up for free, but nothing reaches its members until its first payment.
//
// OFF BY DEFAULT. Nothing is gated unless TENANT_PAYMENT_GATE_ENABLED is exactly "true" on the server, so merging and deploying this changes nothing for S&C or any existing gym
// until the owner switches it on. The primary gym (no gym id), platform operators, and any gym that has been paid (or put on billing by a platform operator, which sets a paid-through
// date) are never gated. Pure rules only; the datastore and request side are in lib/tenant-lockout.ts and lib/email.ts.
import type { GymRecord } from "./gyms-schema";

export function paymentGateEnabled(): boolean {
  return process.env.TENANT_PAYMENT_GATE_ENABLED === "true";
}

/** A gym is live once it has a paid-through date (its first payment, or a platform operator putting it on billing). No gym record (the primary gym) counts as live. */
export function gymIsLive(gym: Pick<GymRecord, "platformBilling"> | null | undefined): boolean {
  if (!gym) return true;
  return typeof gym.platformBilling?.paidThrough === "string" && gym.platformBilling.paidThrough.length > 0;
}

/** True when the gate is on and this gym has not gone live yet. */
export function gymNotLive(gym: Pick<GymRecord, "platformBilling"> | null | undefined): boolean {
  return paymentGateEnabled() && !!gym && !gymIsLive(gym);
}

// The money-back window depends on the gym's size, because a big gym can use a lot of AI and email in a fortnight: 14 days up to 150 members, 7 days for 151 to 300, 3 days above 300
// (owner decision 2026-11-27). The numbers live here so the go-live page, the reminders and the terms all read the same ones.
export const REFUND_WINDOWS: readonly { upTo: number | null; days: number; label: string }[] = [
  { upTo: 150, days: 14, label: "up to 150 members" },
  { upTo: 300, days: 7, label: "151 to 300 members" },
  { upTo: null, days: 3, label: "more than 300 members" },
];

/** The money-back days for a gym with this many members (the size band decides it, so the same count always gives the same answer). */
export function refundWindowDays(members: number): number {
  for (const w of REFUND_WINDOWS) if (w.upTo === null || members <= w.upTo) return w.days;
  return 3;
}

export const REFUND_WINDOWS_TEXT = "You can ask for your money back within 14 days (up to 150 members), 7 days (151 to 300) or 3 days (more than 300).";

export const TENANT_NOT_LIVE_CODE = "tenant_not_live";

export const NOT_LIVE_MEMBER_MESSAGE = "This gym is not open yet.";
export const NOT_LIVE_STAFF_MESSAGE = "Your gym is not live yet. Finish setting up, then go live from Gym setup to use this.";

/** The reminder days after sign-up on which an unpaid gym's owner is nudged. */
export const GO_LIVE_REMINDER_DAYS: readonly number[] = [3, 7, 14];

/** Which reminder is due now: the latest milestone the gym has reached (days since it was created), or null before the first. */
export function dueGoLiveReminder(createdAtIso: string, now: Date): number | null {
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return null;
  const days = Math.floor((now.getTime() - created) / 86_400_000);
  const reached = GO_LIVE_REMINDER_DAYS.filter((d) => days >= d);
  return reached.length ? reached[reached.length - 1] : null;
}
