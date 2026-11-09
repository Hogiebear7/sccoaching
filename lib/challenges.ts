// Community challenges (Community plan, 2026-11): a title, one scoring metric and a date range, scored automatically from the workouts members already
// log. No new scoring rules: volume and the three big lifts are exactly the leaderboard's (lib/leaderboard.ts), and "workouts" counts the days a member
// trained. Pure and DB-free: the route builds the member inputs, this module only computes.
import { communityDisplayName } from "./community-display-name";
import type { ChallengeRecord } from "./db";
import { computeLeaderboard, filterSessionsByRange, type LeaderboardEntry, type LeaderboardMemberInput } from "./leaderboard";

export const CHALLENGE_METRICS = ["volume", "workouts", "squat", "bench", "deadlift"] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];

export const MAX_CHALLENGE_TITLE = 60;
export const MAX_CHALLENGE_DAYS = 90;
export const MAX_START_AHEAD_DAYS = 60;
export const MAX_OPEN_CHALLENGES_PER_SCOPE = 5;

export type ChallengeStatus = "upcoming" | "active" | "ended" | "canceled";

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-31 and the like). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from a to b (both YYYY-MM-DD), so the same day is 0. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

export function challengeStatus(c: Pick<ChallengeRecord, "startDate" | "endDate" | "canceledAt">, today: string): ChallengeStatus {
  if (c.canceledAt) return "canceled";
  if (today < c.startDate) return "upcoming";
  if (today > c.endDate) return "ended";
  return "active";
}

/** A challenge as members see it. */
export function challengeView(c: ChallengeRecord, today: string) {
  return {
    id: c.id,
    title: c.title,
    metric: c.metric,
    startDate: c.startDate,
    endDate: c.endDate,
    status: challengeStatus(c, today),
    createdAt: c.createdAt,
  };
}

/** A challenge that still counts toward the per-group cap: not canceled and not yet over. */
export function isOpenChallenge(c: Pick<ChallengeRecord, "endDate" | "canceledAt">, today: string): boolean {
  return !c.canceledAt && c.endDate >= today;
}

/**
 * Ranks members for one challenge. Only workouts dated inside [startDate, endDate] count. Members who switched the leaderboard off are left out, names follow
 * each member's own real-name setting, and a member with nothing scored yet is not listed (all the same as the main leaderboard).
 */
export function scoreChallenge(metric: ChallengeMetric, members: LeaderboardMemberInput[], startDate: string, endDate: string): LeaderboardEntry[] {
  const inRange = members.map((m) => ({ ...m, sessions: filterSessionsByRange(m.sessions, "custom", startDate, endDate) }));
  if (metric !== "workouts") return computeLeaderboard(metric, inRange);

  const entries: LeaderboardEntry[] = [];
  for (const { userId, fullName, sessions, privacy } of inRange) {
    if (privacy?.leaderboardVisible === false) continue;
    // Days trained, not sessions logged: several entries on one day count once, and an empty session counts for nothing.
    const days = new Set(sessions.filter((s) => s.exercises.length > 0 || s.runs.length > 0).map((s) => s.date));
    if (days.size === 0) continue;
    entries.push({ userId, displayName: communityDisplayName(fullName, privacy), value: days.size, bodyweightPct: null });
  }
  return entries.sort((a, b) => b.value - a.value);
}
