// Self check-in for classes: a member scans the gym's code and is marked as attended for the class they booked.
// Pure helpers only (no database), so the rules can be tested; the routes load the rows.
//
// A gym chooses one of three modes (GymRecord.selfCheckin):
//   off     members cannot check themselves in (staff mark attendance by hand). The default.
//   poster  one printed code on the wall. Simple, but a photo of it works anywhere.
//   live    a code on a screen at the gym that changes on a schedule the gym picks: every minute, every day or every week.
//
// In both modes a scan only ever checks a member in to a class they have ALREADY booked, inside the check-in window.
import { createHmac, timingSafeEqual } from "crypto";

import { classStartMs } from "./class-time";

/** Check-in opens this long before the start and closes when the class ends. */
export const CHECKIN_OPENS_MINS_BEFORE = 30;

export type SelfCheckinMode = "off" | "poster" | "live";
export const SELF_CHECKIN_MODES: readonly SelfCheckinMode[] = ["off", "poster", "live"];

export function isSelfCheckinMode(value: unknown): value is SelfCheckinMode {
  return value === "off" || value === "poster" || value === "live";
}

/** Unset means off. */
export function selfCheckinModeOf(gym: { selfCheckin?: unknown } | null | undefined): SelfCheckinMode {
  const value = gym?.selfCheckin;
  return isSelfCheckinMode(value) ? value : "off";
}

export type CheckinPeriod = "minute" | "day" | "week";
export const CHECKIN_PERIODS: readonly CheckinPeriod[] = ["minute", "day", "week"];
/** How long one code lasts, in seconds. */
export const PERIOD_SECONDS: Record<CheckinPeriod, number> = { minute: 60, day: 86_400, week: 604_800 };
/** A scan taken just before a change is still accepted for this long after it, so a code on a screen that was a little slow to refresh still works. */
/** Weeks start on Monday 00:00 UTC (1 Jan 1970 was a Thursday, so the count is shifted by four days); days start at 00:00 UTC. */
const PERIOD_OFFSET_SECONDS: Record<CheckinPeriod, number> = { minute: 0, day: 0, week: 345_600 };
const PERIOD_GRACE_SECONDS: Record<CheckinPeriod, number> = { minute: 120, day: 3_600, week: 3_600 };
const PERIOD_LETTER: Record<CheckinPeriod, string> = { minute: "m", day: "d", week: "w" };
const LETTER_PERIOD: Record<string, CheckinPeriod> = { m: "minute", d: "day", w: "week" };
/** What a gym gets when it turns on the live code and has not chosen: weekly, so a screen that is a bit behind or offline for a few days still shows a working code. */
export const DEFAULT_CHECKIN_PERIOD: CheckinPeriod = "week";

export function isCheckinPeriod(value: unknown): value is CheckinPeriod {
  return value === "minute" || value === "day" || value === "week";
}
export function checkinPeriodOf(gym: { selfCheckinPeriod?: unknown } | null | undefined): CheckinPeriod {
  return isCheckinPeriod(gym?.selfCheckinPeriod) ? gym.selfCheckinPeriod : DEFAULT_CHECKIN_PERIOD;
}

const POSTER_PREFIX = "sc-checkin";
const LIVE_PREFIX = "sc-live";

function mac(secret: string, text: string): string {
  return createHmac("sha256", secret).update(text).digest("hex").slice(0, 24);
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const keyOf = (gymId: string | null | undefined) => gymId ?? "primary";
const gymIdOf = (gymKey: string) => (gymKey === "primary" ? null : gymKey);

/** Stable per gym ("primary" = the original gym with no gym id). */
export function gymCheckinCode(secret: string, gymId: string | null | undefined): string {
  const gymKey = keyOf(gymId);
  return `${POSTER_PREFIX}:${gymKey}:${mac(secret, `checkin:${gymKey}`)}`;
}

export function livePeriod(nowMs: number, period: CheckinPeriod = "minute"): number {
  return Math.floor((nowMs / 1000 - PERIOD_OFFSET_SECONDS[period]) / PERIOD_SECONDS[period]);
}

/** Seconds until the code shown now is replaced by a new one. */
export function secondsUntilChange(nowMs: number, period: CheckinPeriod): number {
  const len = PERIOD_SECONDS[period];
  const into = (Math.floor(nowMs / 1000) - PERIOD_OFFSET_SECONDS[period]) % len;
  return len - ((into + len) % len);
}

/** The code the gym's screen shows right now. It changes at the end of each period. */
export function liveCheckinCode(secret: string, gymId: string | null | undefined, nowMs: number, period: CheckinPeriod = "minute"): string {
  const gymKey = keyOf(gymId);
  const n = livePeriod(nowMs, period);
  const letter = PERIOD_LETTER[period];
  return `${LIVE_PREFIX}:${gymKey}:${letter}${n}:${mac(secret, `live:${gymKey}:${letter}${n}`)}`;
}

export type ReadCode = { kind: "poster" | "live" | "expired"; gymId: string | null; /** For a live code: how often it changes. */ period?: CheckinPeriod };

/** Reads a scanned code. Returns undefined when it is not one of ours (or has been tampered with). A live code that has run out comes back as "expired". */
export function readAnyCheckinCode(secret: string, code: unknown, nowMs: number): ReadCode | undefined {
  if (typeof code !== "string") return undefined;
  const parts = code.trim().split(":");
  if (parts[0] === POSTER_PREFIX && parts.length === 3) {
    const [, gymKey, given] = parts;
    if (!gymKey || !given || !same(given, mac(secret, `checkin:${gymKey}`))) return undefined;
    return { kind: "poster", gymId: gymIdOf(gymKey) };
  }
  if (parts[0] === LIVE_PREFIX && parts.length === 4) {
    const [, gymKey, stamp, given] = parts;
    const unit = LETTER_PERIOD[stamp?.[0] ?? ""];
    const n = Number(stamp?.slice(1));
    if (!gymKey || !given || !unit || !Number.isInteger(n)) return undefined;
    if (!same(given, mac(secret, `live:${gymKey}:${stamp}`))) return undefined;
    // Valid from the start of its period until the end of it plus a short grace.
    const startMs = (n * PERIOD_SECONDS[unit] + PERIOD_OFFSET_SECONDS[unit]) * 1000;
    const endMs = startMs + (PERIOD_SECONDS[unit] + PERIOD_GRACE_SECONDS[unit]) * 1000;
    if (nowMs < startMs || nowMs >= endMs) return { kind: "expired", gymId: gymIdOf(gymKey), period: unit };
    return { kind: "live", gymId: gymIdOf(gymKey), period: unit };
  }
  return undefined;
}

/** The gym of a valid poster code (kept for the original poster-only callers and tests). */
export function readCheckinCode(secret: string, code: unknown): { gymId: string | null } | undefined {
  const read = readAnyCheckinCode(secret, code, Date.now());
  return read && read.kind === "poster" ? { gymId: read.gymId } : undefined;
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
