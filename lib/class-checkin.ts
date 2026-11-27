// Self check-in for classes: a member scans the gym's poster code and is marked as attended for the class they booked.
// Pure helpers only (no database), so the rules can be tested; the route loads the rows.
//
// Rules, kept deliberately simple and strict:
//  - The code identifies the gym (a signed value, not guessable), so it can sit on a printed poster.
//  - It only works for a class the member has ALREADY booked, starting within the check-in window.
//  - A photo of the poster cannot check someone in for a class they did not book, or outside the window.
import { createHmac, timingSafeEqual } from "crypto";

import { classStartMs } from "./class-time";

/** Check-in opens this long before the start and closes when the class ends. */
export const CHECKIN_OPENS_MINS_BEFORE = 30;

const PREFIX = "sc-checkin";

function mac(secret: string, gymKey: string): string {
  return createHmac("sha256", secret).update(`checkin:${gymKey}`).digest("hex").slice(0, 24);
}

/** Stable per gym ("primary" = the original gym with no gym id). */
export function gymCheckinCode(secret: string, gymId: string | null | undefined): string {
  const gymKey = gymId ?? "primary";
  return `${PREFIX}:${gymKey}:${mac(secret, gymKey)}`;
}

/** Returns the gym id the code belongs to (null = primary gym), or undefined when the code is not valid. */
export function readCheckinCode(secret: string, code: unknown): { gymId: string | null } | undefined {
  if (typeof code !== "string") return undefined;
  const parts = code.trim().split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX) return undefined;
  const [, gymKey, given] = parts;
  if (!gymKey || !given) return undefined;
  const expected = mac(secret, gymKey);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return { gymId: gymKey === "primary" ? null : gymKey };
}

export type CheckinState = "too_early" | "open" | "ended";

export function checkinState(date: string, startTime: string, durationMins: number, nowMs: number): CheckinState {
  const start = classStartMs(date, startTime);
  if (nowMs < start - CHECKIN_OPENS_MINS_BEFORE * 60_000) return "too_early";
  if (nowMs > start + durationMins * 60_000) return "ended";
  return "open";
}

export interface CheckinCandidate {
  bookingId: string;
  classId: string;
  title: string;
  date: string;
  startTime: string;
  durationMins: number;
  attendedAt: string | null;
}

export type CheckinOutcome =
  | { kind: "checked_in"; bookingId: string; title: string }
  | { kind: "already"; title: string }
  | { kind: "too_early"; title: string; startTime: string }
  | { kind: "none"; message: string };

/** Picks what a scan should do from the member's own bookings. The nearest open class wins; otherwise explain why not. */
export function chooseCheckin(candidates: CheckinCandidate[], nowMs: number): CheckinOutcome {
  const withState = candidates
    .map((c) => ({ c, state: checkinState(c.date, c.startTime, c.durationMins, nowMs), start: classStartMs(c.date, c.startTime) }))
    .sort((a, b) => a.start - b.start);

  const open = withState.filter((x) => x.state === "open");
  const next = open.find((x) => !x.c.attendedAt);
  if (next) return { kind: "checked_in", bookingId: next.c.bookingId, title: next.c.title };
  if (open.length > 0) return { kind: "already", title: open[0].c.title };

  const soon = withState.find((x) => x.state === "too_early" && x.start - nowMs < 6 * 3_600_000);
  if (soon) return { kind: "too_early", title: soon.c.title, startTime: soon.c.startTime };

  return { kind: "none", message: "You have no booked class right now. Check-in opens 30 minutes before a class you have booked." };
}
