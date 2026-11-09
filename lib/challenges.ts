// Community challenges (Community plan, 2026-11): a title, one scoring metric and a date range, scored automatically from the workouts members already
// log. Strength: volume and the three big lifts are exactly the leaderboard's (lib/leaderboard.ts). Everything else is worked out here from what a member
// logged: days trained and total training time, and distance and time from their run and cardio entries. Pure and DB-free: the route builds the member
// inputs, this module only computes.
import { communityDisplayName } from "./community-display-name";
import type { ChallengeRecord, WorkoutRunEntry, WorkoutSessionRecord } from "./db";
import { computeLeaderboard, filterSessionsByRange, type LeaderboardEntry, type LeaderboardMemberInput } from "./leaderboard";

/** Challenge metrics, grouped for display. The order here is the order the apps show them in. */
export const CHALLENGE_CATEGORIES = [
  { id: "strength", label: "Strength", metrics: ["volume", "squat", "bench", "deadlift"] },
  { id: "consistency", label: "Consistency", metrics: ["workouts", "training_time"] },
  { id: "running", label: "Running", metrics: ["run_distance", "run_longest", "run_time"] },
  { id: "cardio", label: "Cardio", metrics: ["cardio_time", "cardio_distance", "bike_distance", "row_distance"] },
] as const;

export const CHALLENGE_METRICS = [
  "volume",
  "squat",
  "bench",
  "deadlift",
  "workouts",
  "training_time",
  "run_distance",
  "run_longest",
  "run_time",
  "cardio_time",
  "cardio_distance",
  "bike_distance",
  "row_distance",
] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];

/** How a metric's number is meant to be read: kilograms, kilometres, minutes or a count of days. Values are already rounded for that unit. */
export const CHALLENGE_METRIC_UNIT: Record<ChallengeMetric, "kg" | "km" | "min" | "days"> = {
  volume: "kg",
  squat: "kg",
  bench: "kg",
  deadlift: "kg",
  workouts: "days",
  training_time: "min",
  run_distance: "km",
  run_longest: "km",
  run_time: "min",
  cardio_time: "min",
  cardio_distance: "km",
  bike_distance: "km",
  row_distance: "km",
};

/** Plain-words names, used in notifications and anywhere the server writes a sentence about a challenge. */
export const CHALLENGE_METRIC_LABEL: Record<ChallengeMetric, string> = {
  volume: "Total volume",
  squat: "Best squat",
  bench: "Best bench",
  deadlift: "Best deadlift",
  workouts: "Days trained",
  training_time: "Total training time",
  run_distance: "Running distance",
  run_longest: "Longest run",
  run_time: "Running time",
  cardio_time: "Cardio time",
  cardio_distance: "Cardio distance",
  bike_distance: "Cycling distance",
  row_distance: "Rowing distance",
};

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

export type ParsedChallengeInput =
  | { ok: true; title: string; metric: ChallengeMetric; startDate: string; endDate: string }
  | { ok: false; message: string };

/** Validates what an organiser or coach sent when setting a challenge (the same rules for a group and for the gym). Wording checks stay with the route. */
export function parseChallengeInput(body: unknown, today: string): ParsedChallengeInput {
  const { title, metric, startDate, endDate } = (body ?? {}) as Record<string, unknown>;
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle || cleanTitle.length > MAX_CHALLENGE_TITLE) {
    return { ok: false, message: `Give the challenge a title of up to ${MAX_CHALLENGE_TITLE} characters.` };
  }
  if (typeof metric !== "string" || !(CHALLENGE_METRICS as readonly string[]).includes(metric)) {
    return { ok: false, message: "Choose what the challenge is scored on." };
  }
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return { ok: false, message: "Choose a start and end date." };
  if (startDate < today) return { ok: false, message: "A challenge can't start in the past." };
  if (daysBetween(today, startDate) > MAX_START_AHEAD_DAYS) {
    return { ok: false, message: `A challenge can start up to ${MAX_START_AHEAD_DAYS} days from now.` };
  }
  if (endDate < startDate) return { ok: false, message: "The end date can't be before the start date." };
  if (daysBetween(startDate, endDate) + 1 > MAX_CHALLENGE_DAYS) {
    return { ok: false, message: `A challenge can run for up to ${MAX_CHALLENGE_DAYS} days.` };
  }
  return { ok: true, title: cleanTitle, metric: metric as ChallengeMetric, startDate, endDate };
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
  if (metric === "volume" || metric === "squat" || metric === "bench" || metric === "deadlift") return computeLeaderboard(metric, inRange);

  const entries: LeaderboardEntry[] = [];
  for (const { userId, fullName, sessions, privacy } of inRange) {
    if (privacy?.leaderboardVisible === false) continue;
    const value = scoreSessions(metric, sessions);
    if (value <= 0) continue;
    entries.push({ userId, displayName: communityDisplayName(fullName, privacy), value, bodyweightPct: null });
  }
  return entries.sort((a, b) => b.value - a.value);
}

// ── Scoring from logged sessions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cardio types that count as running. An entry with no type is a run (older entries were all runs). */
const isRun = (r: WorkoutRunEntry) => r.cardioType === undefined || r.cardioType === "run";
const isBike = (r: WorkoutRunEntry) => r.cardioType === "bike";
const isRower = (r: WorkoutRunEntry) => r.cardioType === "rower";

const km = (r: WorkoutRunEntry) => (typeof r.distance === "number" && Number.isFinite(r.distance) && r.distance > 0 ? r.distance : 0);
const secs = (r: WorkoutRunEntry) => (typeof r.durationSecs === "number" && Number.isFinite(r.durationSecs) && r.durationSecs > 0 ? r.durationSecs : 0);

const sum = (items: WorkoutRunEntry[], f: (r: WorkoutRunEntry) => number) => items.reduce((total, r) => total + f(r), 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One member's score for a non-strength metric over the sessions already limited to the challenge's dates. Distances are kilometres to one decimal, times are
 * whole minutes. An entry with no distance (or no time) adds nothing to a distance (or time) score rather than failing, so a half-filled entry never breaks
 * the board. 0 means "nothing scored", and a member with 0 is not listed.
 */
export function scoreSessions(metric: ChallengeMetric, sessions: WorkoutSessionRecord[]): number {
  const runs = sessions.flatMap((s) => s.runs ?? []);
  switch (metric) {
    case "workouts":
      // Days trained, not sessions logged: several entries on one day count once, and an empty session counts for nothing.
      return new Set(sessions.filter((s) => (s.exercises?.length ?? 0) > 0 || (s.runs?.length ?? 0) > 0).map((s) => s.date)).size;
    case "training_time":
      return Math.round(sessions.reduce((total, s) => total + (typeof s.durationMins === "number" && s.durationMins > 0 ? s.durationMins : 0), 0));
    case "run_distance":
      return round1(sum(runs.filter(isRun), km));
    case "run_longest":
      return round1(Math.max(0, ...runs.filter(isRun).map(km)));
    case "run_time":
      return Math.round(sum(runs.filter(isRun), secs) / 60);
    case "cardio_time":
      return Math.round(sum(runs, secs) / 60);
    case "cardio_distance":
      return round1(sum(runs, km));
    case "bike_distance":
      return round1(sum(runs.filter(isBike), km));
    case "row_distance":
      return round1(sum(runs.filter(isRower), km));
    default:
      // volume and the lifts are scored by the leaderboard; reaching here means a metric was added without a rule for it.
      return 0;
  }
}
