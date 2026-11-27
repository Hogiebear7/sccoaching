// Self check-in for classes: a member scans the gym's code and is marked as attended for the class they booked.
// Pure helpers only (no database), so the rules can be tested; the routes load the rows.
//
// A gym chooses one of three modes (GymRecord.selfCheckin):
//   off     members cannot check themselves in (staff mark attendance by hand). The default.
//   poster  one printed code on the wall. Simple, but a photo of it works anywhere.
//   live    a code on a screen at the gym that changes every minute, so a photo is useless a couple of minutes later.
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

const POSTER_PREFIX = "sc-checkin";
const LIVE_PREFIX = "sc-live";
/** How long one live code lasts, and how many earlier ones are still accepted (a scan taken just before the change). */
export const LIVE_CODE_SECONDS = 60;
export const LIVE_CODE_GRACE_PERIODS = 1;

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

export function livePeriod(nowMs: number): number {
  return Math.floor(nowMs / (LIVE_CODE_SECONDS * 1000));
}

/** The code the gym's screen shows right now. Changes every LIVE_CODE_SECONDS. */
export function liveCheckinCode(secret: string, gymId: string | null | undefined, nowMs: number): string {
  const gymKey = keyOf(gymId);
  const period = livePeriod(nowMs);
  return `${LIVE_PREFIX}:${gymKey}:${period}:${mac(secret, `live:${gymKey}:${period}`)}`;
}

export type ReadCode = { kind: "poster" | "live" | "expired"; gymId: string | null };

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
    const [, gymKey, periodText, given] = parts;
    const period = Number(periodText);
    if (!gymKey || !given || !Number.isInteger(period)) return undefined;
    if (!same(given, mac(secret, `live:${gymKey}:${period}`))) return undefined;
    const age = livePeriod(nowMs) - period;
    if (age < 0 || age > LIVE_CODE_GRACE_PERIODS) return { kind: "expired", gymId: gymIdOf(gymKey) };
    return { kind: "live", gymId: gymIdOf(gymKey) };
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
