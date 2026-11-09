// Community challenges (Community plan, 2026-11): a title, one scoring metric and a date range, scored automatically from the workouts members already
// log. Strength: volume and the three big lifts are exactly the leaderboard's (lib/leaderboard.ts). Everything else is worked out here from what a member
// logged: days trained and total training time, and distance and time from their run and cardio entries. Pure and DB-free: the route builds the member
// inputs, this module only computes.
import { communityDisplayName } from "./community-display-name";
import type { ChallengeRecord, WorkoutRunEntry, WorkoutSessionRecord } from "./db";
import { CARDIO_TYPES, type CardioType } from "./workout-entries";
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
/** The ready-made kinds. A challenge can also be "custom": the setter chooses the exercise or activity and what to measure (see CustomChallenge below). */
export type BuiltInChallengeMetric = (typeof CHALLENGE_METRICS)[number];
export const CUSTOM_METRIC = "custom" as const;
export type ChallengeMetric = BuiltInChallengeMetric | typeof CUSTOM_METRIC;

/** How a number is meant to be read: kilograms, kilometres, minutes, a count of days or reps, or seconds (a time to beat). Values are already rounded for that unit. */
export type ChallengeUnit = "kg" | "km" | "min" | "days" | "reps" | "secs";

export const CHALLENGE_METRIC_UNIT: Record<BuiltInChallengeMetric, ChallengeUnit> = {
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
export const CHALLENGE_METRIC_LABEL: Record<BuiltInChallengeMetric, string> = {
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

// ── Custom challenges ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a custom challenge measures. The unit follows from it (so "best squat in kilometres" cannot be asked for):
 *   Strength, of an exercise the setter names:  best_weight (kg), total_volume (kg), best_reps (reps in one set), total_reps (reps)
 *   Cardio, of one activity the setter picks:   total_distance (km), longest_distance (km, one entry), total_time (minutes), fastest_time (seconds, lowest wins)
 */
export const CUSTOM_MEASURES = ["best_weight", "total_volume", "best_reps", "total_reps", "total_distance", "longest_distance", "total_time", "fastest_time"] as const;
export type CustomMeasure = (typeof CUSTOM_MEASURES)[number];

export const STRENGTH_MEASURES: readonly CustomMeasure[] = ["best_weight", "total_volume", "best_reps", "total_reps"];
export const CARDIO_MEASURES: readonly CustomMeasure[] = ["total_distance", "longest_distance", "total_time", "fastest_time"];

export const CUSTOM_MEASURE_UNIT: Record<CustomMeasure, ChallengeUnit> = {
  best_weight: "kg",
  total_volume: "kg",
  best_reps: "reps",
  total_reps: "reps",
  total_distance: "km",
  longest_distance: "km",
  total_time: "min",
  fastest_time: "secs",
};

export const CARDIO_TYPE_NAME: Record<CardioType, string> = {
  run: "Run",
  walk: "Walk",
  treadmill_walk: "Treadmill walk",
  stair_climber: "Stair climber",
  bike: "Bike",
  rower: "Rower",
  cross_trainer: "Cross trainer",
  other: "Other cardio",
};

export interface CustomChallenge {
  measure: CustomMeasure;
  /** Strength: the exercise as the setter typed it. Cardio: a generated name such as "5 km Run". Always set. */
  subject: string;
  /** Cardio measures only. */
  cardioType: CardioType | null;
  /** fastest_time only: the distance to be covered, in km. */
  targetDistanceKm: number | null;
}

export const MIN_CUSTOM_SUBJECT = 2;
export const MAX_CUSTOM_SUBJECT = 40;
export const MIN_TARGET_KM = 0.1;
export const MAX_TARGET_KM = 100;
/** A fastest-time entry counts when its logged distance is from 1% under to 5% over the target, so a GPS run of 4.98 km counts for a 5 km challenge. */
export const TARGET_DISTANCE_UNDER = 0.99;
export const TARGET_DISTANCE_OVER = 1.05;

const kmText = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 100) / 100} km`;

/** The plain-words name of a custom challenge: "Front squat: best weight", "5 km Run: fastest time". */
export function customChallengeLabel(c: CustomChallenge): string {
  const cardio = c.cardioType ? CARDIO_TYPE_NAME[c.cardioType] : "";
  switch (c.measure) {
    case "best_weight":
      return `${c.subject}: best weight`;
    case "total_volume":
      return `${c.subject}: total volume`;
    case "best_reps":
      return `${c.subject}: most reps in a set`;
    case "total_reps":
      return `${c.subject}: total reps`;
    case "total_distance":
      return `${cardio}: total distance`;
    case "longest_distance":
      return `${cardio}: longest single distance`;
    case "total_time":
      return `${cardio}: total time`;
    case "fastest_time":
      return `${c.subject}: fastest time`;
  }
}

export type ParsedCustomChallenge = { ok: true; custom: CustomChallenge } | { ok: false; message: string };

/** Validates the custom part of a challenge. Wording checks (community rules) stay with the route, which runs them on `custom.subject`. */
export function parseCustomChallenge(raw: unknown): ParsedCustomChallenge {
  const { measure, subject, cardioType, targetDistanceKm } = (raw ?? {}) as Record<string, unknown>;
  if (typeof measure !== "string" || !(CUSTOM_MEASURES as readonly string[]).includes(measure)) {
    return { ok: false, message: "Choose what to measure." };
  }
  const m = measure as CustomMeasure;

  if (STRENGTH_MEASURES.includes(m)) {
    const name = typeof subject === "string" ? subject.trim().replace(/\s+/g, " ") : "";
    if (name.length < MIN_CUSTOM_SUBJECT || name.length > MAX_CUSTOM_SUBJECT || !/[A-Za-z]/.test(name)) {
      return { ok: false, message: `Name the exercise, ${MIN_CUSTOM_SUBJECT} to ${MAX_CUSTOM_SUBJECT} characters.` };
    }
    return { ok: true, custom: { measure: m, subject: name, cardioType: null, targetDistanceKm: null } };
  }

  if (typeof cardioType !== "string" || !(CARDIO_TYPES as readonly string[]).includes(cardioType)) {
    return { ok: false, message: "Choose the activity." };
  }
  const type = cardioType as CardioType;
  if (m !== "fastest_time") {
    return { ok: true, custom: { measure: m, subject: CARDIO_TYPE_NAME[type], cardioType: type, targetDistanceKm: null } };
  }
  const target = typeof targetDistanceKm === "number" ? Math.round(targetDistanceKm * 100) / 100 : NaN;
  if (!Number.isFinite(target) || target < MIN_TARGET_KM || target > MAX_TARGET_KM) {
    return { ok: false, message: `Enter the distance, between ${MIN_TARGET_KM} and ${MAX_TARGET_KM} km.` };
  }
  return { ok: true, custom: { measure: m, subject: `${kmText(target)} ${CARDIO_TYPE_NAME[type]}`, cardioType: type, targetDistanceKm: target } };
}

/** The name a challenge is shown by: the setter's choice for a custom one, the ready-made name otherwise. */
export function challengeLabel(metric: ChallengeMetric, custom: CustomChallenge | null | undefined): string {
  if (metric === CUSTOM_METRIC) return custom ? customChallengeLabel(custom) : "Custom challenge";
  return CHALLENGE_METRIC_LABEL[metric] ?? "Challenge";
}

export function challengeUnit(metric: ChallengeMetric, custom: CustomChallenge | null | undefined): ChallengeUnit {
  if (metric === CUSTOM_METRIC) return custom ? CUSTOM_MEASURE_UNIT[custom.measure] : "kg";
  return CHALLENGE_METRIC_UNIT[metric];
}

/** A fastest-time challenge is won by the lowest number; everything else by the highest. */
export const challengeLowerIsBetter = (metric: ChallengeMetric, custom: CustomChallenge | null | undefined) => metric === CUSTOM_METRIC && custom?.measure === "fastest_time";

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
  | { ok: true; title: string; metric: ChallengeMetric; custom: CustomChallenge | null; startDate: string; endDate: string }
  | { ok: false; message: string };

/**
 * Validates what an organiser or coach sent when setting a challenge (the same rules for a group and for the gym). Wording checks stay with the route. `metric`
 * is one of the ready-made kinds, or "custom" together with a `custom` object (see parseCustomChallenge).
 */
export function parseChallengeInput(body: unknown, today: string): ParsedChallengeInput {
  const { title, metric, custom: rawCustom, startDate, endDate } = (body ?? {}) as Record<string, unknown>;
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle || cleanTitle.length > MAX_CHALLENGE_TITLE) {
    return { ok: false, message: `Give the challenge a title of up to ${MAX_CHALLENGE_TITLE} characters.` };
  }
  const isCustom = metric === CUSTOM_METRIC;
  if (typeof metric !== "string" || (!isCustom && !(CHALLENGE_METRICS as readonly string[]).includes(metric))) {
    return { ok: false, message: "Choose what the challenge is scored on." };
  }
  let custom: CustomChallenge | null = null;
  if (isCustom) {
    const parsed = parseCustomChallenge(rawCustom);
    if (!parsed.ok) return parsed;
    custom = parsed.custom;
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
  return { ok: true, title: cleanTitle, metric: metric as ChallengeMetric, custom, startDate, endDate };
}

/**
 * A challenge as members see it. Besides the stored fields it says how to read it: `label` (what it is called), `unit` (what the numbers are) and
 * `lowerIsBetter` (a time to beat), so an app never has to guess for a kind it doesn't know. `custom` is null for the ready-made kinds.
 */
export function challengeView(c: ChallengeRecord, today: string) {
  const custom = c.custom ?? null;
  return {
    id: c.id,
    title: c.title,
    metric: c.metric,
    custom,
    label: challengeLabel(c.metric, custom),
    unit: challengeUnit(c.metric, custom),
    lowerIsBetter: challengeLowerIsBetter(c.metric, custom),
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
export function scoreChallenge(
  metric: ChallengeMetric,
  members: LeaderboardMemberInput[],
  startDate: string,
  endDate: string,
  custom?: CustomChallenge | null
): LeaderboardEntry[] {
  const inRange = members.map((m) => ({ ...m, sessions: filterSessionsByRange(m.sessions, "custom", startDate, endDate) }));
  if (metric === "volume" || metric === "squat" || metric === "bench" || metric === "deadlift") return computeLeaderboard(metric, inRange);
  // A custom challenge whose definition is missing scores nobody rather than guessing.
  if (metric === CUSTOM_METRIC && !custom) return [];

  const entries: LeaderboardEntry[] = [];
  for (const { userId, fullName, sessions, privacy } of inRange) {
    if (privacy?.leaderboardVisible === false) continue;
    const value = metric === CUSTOM_METRIC ? scoreCustom(custom as CustomChallenge, sessions) : scoreSessions(metric, sessions);
    if (value <= 0) continue;
    entries.push({ userId, displayName: communityDisplayName(fullName, privacy), value, bodyweightPct: null });
  }
  // Highest first, except a time to beat, where the lowest is first.
  const lower = challengeLowerIsBetter(metric, custom);
  return entries.sort((a, b) => (lower ? a.value - b.value : b.value - a.value));
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
export function scoreSessions(metric: BuiltInChallengeMetric, sessions: WorkoutSessionRecord[]): number {
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

// ── Custom challenges: scoring ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lower-case words of a name, with punctuation dropped and a plural "s" trimmed so "squats", "pull-ups" and "dips" match "squat", "pull up" and "dip" ("press" and "ss" words keep theirs). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * Does a logged exercise name match what the setter typed? Every word they typed must be in the logged name, in any order: "front squat" matches "Barbell
 * Front Squat" and "Squat (front)" but not "Back Squat", and "squat" matches all of them.
 */
export function exerciseMatches(loggedName: string, subject: string): boolean {
  const wanted = words(subject);
  if (wanted.length === 0) return false;
  const have = new Set(words(loggedName));
  return wanted.every((w) => have.has(w));
}

/** One performed set. Warm-up sets never count, so a light warm-up can't set a record and doesn't pad a total. */
interface PerformedSet {
  weight: number;
  reps: number;
}

function numberOr0(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function performedSets(ex: WorkoutSessionRecord["exercises"][number]): PerformedSet[] {
  if (ex.setDetails && ex.setDetails.length > 0) {
    return ex.setDetails
      .filter((s) => s.setType !== "warmup")
      .map((s) => ({
        weight: numberOr0(s.weight),
        // A per-side set stores right and left reps instead of reps; together they are the reps done.
        reps: numberOr0(s.reps ?? (s.repsRight != null && s.repsLeft != null ? s.repsRight + s.repsLeft : null)),
      }));
  }
  if (ex.setType === "warmup") return [];
  // A single summary entry stands for `sets` identical sets (one when sets is missing).
  const count = Math.max(1, Math.round(numberOr0(ex.sets)) || 1);
  return Array.from({ length: count }, () => ({ weight: numberOr0(ex.weight), reps: numberOr0(ex.reps) }));
}

/**
 * One member's score for a custom challenge over the sessions already limited to its dates. Strength measures read the sets of every logged exercise that
 * matches the setter's words; cardio measures read the entries of the chosen activity (an entry with no type is a run). Half-filled entries add nothing.
 * Weights and totals are kilograms (the app logs kilograms) to one decimal, distances kilometres to one decimal, time totals whole minutes, a fastest time
 * whole seconds. 0 means "nothing scored".
 */
export function scoreCustom(custom: CustomChallenge, sessions: WorkoutSessionRecord[]): number {
  if (STRENGTH_MEASURES.includes(custom.measure)) {
    const sets = sessions.flatMap((s) => (s.exercises ?? []).filter((ex) => exerciseMatches(ex.name ?? "", custom.subject)).flatMap(performedSets));
    switch (custom.measure) {
      case "best_weight":
        return round1(Math.max(0, ...sets.map((s) => s.weight)));
      case "total_volume":
        return round1(sets.reduce((total, s) => total + s.weight * s.reps, 0));
      case "best_reps":
        return Math.max(0, ...sets.map((s) => s.reps));
      case "total_reps":
        return sets.reduce((total, s) => total + s.reps, 0);
      default:
        return 0;
    }
  }

  const type = custom.cardioType;
  if (!type) return 0;
  const entries = sessions.flatMap((s) => s.runs ?? []).filter((r) => (type === "run" ? isRun(r) : r.cardioType === type));
  switch (custom.measure) {
    case "total_distance":
      return round1(sum(entries, km));
    case "longest_distance":
      return round1(Math.max(0, ...entries.map(km)));
    case "total_time":
      return Math.round(sum(entries, secs) / 60);
    case "fastest_time": {
      const target = custom.targetDistanceKm;
      if (!target) return 0;
      const times = entries.filter((r) => km(r) >= target * TARGET_DISTANCE_UNDER && km(r) <= target * TARGET_DISTANCE_OVER && secs(r) > 0).map(secs);
      return times.length ? Math.round(Math.min(...times)) : 0;
    }
    default:
      return 0;
  }
}
