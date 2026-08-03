import type { ExerciseSection, WorkoutSessionRecord } from "@/lib/db";

export interface ExerciseHistoryEntry {
  date: string;
  sessionTitle: string;
  sets: number | null;
  reps: number | null;
  weight: string | null;
  notes: string | null;
}

export interface PersonalBest {
  exerciseName: string;
  heaviestWeight: { weightStr: string; value: number; date: string; reps: number | null } | null;
  highestReps: { reps: number; date: string } | null;
}

// Sessions are expected newest-first (as returned by findWorkoutSessionsByUserId).
// Returns matching entries in the same order. Matches case-insensitively by
// substring so "press" finds "Bench Press", "Shoulder Press", etc.
// Works for free-text and library-linked exercises equally — searches the
// stored name snapshot, not exerciseId.
export function findExerciseHistory(
  sessions: WorkoutSessionRecord[],
  query: string
): ExerciseHistoryEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const entries: ExerciseHistoryEntry[] = [];

  for (const session of sessions) {
    for (const ex of session.exercises) {
      if (ex.name.toLowerCase().includes(normalized)) {
        entries.push({
          date: session.date,
          sessionTitle: session.title,
          sets: ex.sets,
          reps: ex.reps,
          weight: ex.weight,
          notes: ex.notes,
        });
      }
    }
  }

  return entries;
}

// Groups all logged exercise entries by name (case-insensitive). For each
// group computes heaviest numeric weight and highest reps. Exercises where
// neither PB type can be determined are excluded. Iterating newest-first
// means the first time we see a value equal to the current maximum, we keep
// the existing (more recent) record — so ties naturally resolve to the most
// recent entry.
export function computePersonalBests(sessions: WorkoutSessionRecord[]): PersonalBest[] {
  const groups = new Map<
    string,
    {
      displayName: string;
      heaviest: { value: number; weightStr: string; date: string; reps: number | null } | null;
      highestReps: { reps: number; date: string } | null;
    }
  >();

  for (const session of sessions) {
    for (const ex of session.exercises) {
      const lower = ex.name.trim().toLowerCase();
      if (!lower) continue;

      const group = groups.get(lower) ?? {
        displayName: ex.name.trim(),
        heaviest: null,
        highestReps: null,
      };

      // Per-set details (when present) are the true performed values; the
      // shared weight/reps fields are the fallback for single-value entries.
      const candidates: { weight: string | null; reps: number | null }[] =
        ex.setDetails && ex.setDetails.length > 0
          ? ex.setDetails
          : [{ weight: ex.weight, reps: ex.reps }];

      for (const set of candidates) {
        if (set.weight) {
          const num = parseFloat(set.weight);
          if (Number.isFinite(num) && (group.heaviest === null || num > group.heaviest.value)) {
            group.heaviest = { value: num, weightStr: set.weight, date: session.date, reps: set.reps };
          }
        }
        if (set.reps !== null && (group.highestReps === null || set.reps > group.highestReps.reps)) {
          group.highestReps = { reps: set.reps, date: session.date };
        }
      }

      groups.set(lower, group);
    }
  }

  const result: PersonalBest[] = [];

  for (const { displayName, heaviest, highestReps } of groups.values()) {
    if (heaviest === null && highestReps === null) continue;
    result.push({ exerciseName: displayName, heaviestWeight: heaviest, highestReps });
  }

  return result.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

export interface ExerciseTrendPoint {
  date: string;
  weightNum: number | null;
  rawWeight: string | null;
  reps: number | null;
}

// Returns data points oldest-first for left-to-right chart rendering.
// Matches exercise name exactly (case-insensitive). When the same exercise
// appears more than once in a session date, keeps the best entry: highest
// numeric weight takes priority; falls back to highest reps if no numeric
// weights exist in that date group.
export function getExerciseTrend(
  sessions: WorkoutSessionRecord[],
  exerciseName: string
): ExerciseTrendPoint[] {
  const normalized = exerciseName.trim().toLowerCase();
  if (!normalized) return [];

  const byDate = new Map<string, ExerciseTrendPoint>();

  for (const session of sessions) {
    for (const ex of session.exercises) {
      if (ex.name.trim().toLowerCase() !== normalized) continue;

      const weightNum = ex.weight ? parseFloat(ex.weight) : NaN;
      const numericWeight = Number.isFinite(weightNum) ? weightNum : null;

      const existing = byDate.get(session.date);

      if (!existing) {
        byDate.set(session.date, {
          date: session.date,
          weightNum: numericWeight,
          rawWeight: ex.weight,
          reps: ex.reps,
        });
        continue;
      }

      const betterWeight =
        numericWeight !== null &&
        (existing.weightNum === null || numericWeight > existing.weightNum);

      const betterReps =
        numericWeight === null &&
        existing.weightNum === null &&
        ex.reps !== null &&
        (existing.reps === null || ex.reps > existing.reps);

      if (betterWeight || betterReps) {
        byDate.set(session.date, {
          date: session.date,
          weightNum: numericWeight,
          rawWeight: ex.weight,
          reps: ex.reps,
        });
      }
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export interface WeeklyWorkoutStats {
  /** Sessions logged since Monday of the current ISO week. */
  count: number;
  /** Total volume lifted this week: Σ sets × reps × numeric weight (kg). */
  totalKg: number;
}

export function weeklyWorkoutStats(
  sessions: WorkoutSessionRecord[],
  todayISO: string
): WeeklyWorkoutStats {
  const d = new Date(`${todayISO}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  const mondayISO = d.toISOString().slice(0, 10);

  let count = 0;
  let totalKg = 0;
  for (const session of sessions) {
    if (session.date < mondayISO || session.date > todayISO) continue;
    count += 1;
    for (const ex of session.exercises) {
      if (ex.setDetails && ex.setDetails.length > 0) {
        for (const set of ex.setDetails) {
          if (!set.weight) continue;
          const w = parseFloat(set.weight);
          if (!Number.isFinite(w)) continue;
          totalKg += (set.reps ?? 1) * w;
        }
        continue;
      }
      if (!ex.weight) continue;
      const w = parseFloat(ex.weight);
      if (!Number.isFinite(w)) continue;
      totalKg += (ex.sets ?? 1) * (ex.reps ?? 1) * w;
    }
  }
  return { count, totalKg: Math.round(totalKg) };
}

// Consecutive ISO weeks (Mon–Sun), ending with the current week, that have
// at least one logged session. A week with zero sessions so far (including
// the current, still-in-progress week) breaks the streak — no grace period,
// so the number stays honest rather than flattering. Pure display derivation
// for Variant B's consistency framing; does not touch session creation.
export function computeWeeklyStreak(sessions: WorkoutSessionRecord[], todayISO: string): number {
  const sessionDates = new Set(sessions.map((s) => s.date));
  if (sessionDates.size === 0) return 0;

  function mondayOf(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  }

  function weekHasSession(mondayISO: string): boolean {
    const start = new Date(`${mondayISO}T00:00:00Z`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      if (sessionDates.has(d.toISOString().slice(0, 10))) return true;
    }
    return false;
  }

  let streak = 0;
  let cursor = mondayOf(todayISO);
  while (weekHasSession(cursor)) {
    streak += 1;
    const d = new Date(`${cursor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    cursor = d.toISOString().slice(0, 10);
  }
  return streak;
}

// ── Muscle set levels — weekly training-volume balance per muscle group ──
//
// Cardio is excluded: "sets" isn't a meaningful measure of cardio work, and
// cardio load is tracked separately (WorkoutRunEntry), so folding it in here
// would blur two different kinds of load into one number.
export type StrengthSection = Exclude<ExerciseSection, "cardio">;

export const SET_LEVEL_SECTIONS: StrengthSection[] = [
  "upper_push",
  "upper_pull",
  "lower_push",
  "lower_pull",
  "core",
];

function isStrengthSection(section: ExerciseSection): section is StrengthSection {
  return section !== "cardio";
}

export type SetLevelTier = "none" | "low" | "moderate" | "high";

export interface MuscleSetLevel {
  section: StrengthSection;
  weeklySets: number;
  tier: SetLevelTier;
}

export interface MuscleSetLevelsResult {
  levels: Record<StrengthSection, MuscleSetLevel>;
  /** Sessions in the window, regardless of whether any exercise resolved. */
  sessionsInWindow: number;
  /** Of those, how many had at least one library-linked (section-resolvable)
      exercise — the gap between this and sessionsInWindow is free-text work
      that can't be attributed to a muscle group. */
  resolvedSessions: number;
}

function tierForWeeklySets(weeklySets: number): SetLevelTier {
  if (weeklySets >= 15) return "high";
  if (weeklySets >= 7) return "moderate";
  if (weeklySets >= 1) return "low";
  return "none";
}

// Weekly-average logged sets per muscle group over a rolling window ending
// today, resolved via each entry's exerciseId → library section. Free-text
// entries (exerciseId null, or an id the library no longer has) are honestly
// excluded rather than guessed — same rule as the History muscle-map icon.
// windowDays should be a multiple of 7 so the weekly average is meaningful.
export function computeMuscleSetLevels(
  sessions: WorkoutSessionRecord[],
  sectionByExerciseId: Map<string, ExerciseSection>,
  windowDays: number,
  todayISO: string
): MuscleSetLevelsResult {
  const start = new Date(`${todayISO}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  const startISO = start.toISOString().slice(0, 10);

  const totals = Object.fromEntries(SET_LEVEL_SECTIONS.map((s) => [s, 0])) as Record<StrengthSection, number>;

  let sessionsInWindow = 0;
  let resolvedSessions = 0;

  for (const session of sessions) {
    if (session.date < startISO || session.date > todayISO) continue;
    sessionsInWindow += 1;

    let resolvedAny = false;
    for (const ex of session.exercises) {
      const section = ex.exerciseId ? sectionByExerciseId.get(ex.exerciseId) : undefined;
      if (!section || !isStrengthSection(section)) continue;

      const setCount = ex.setDetails && ex.setDetails.length > 0 ? ex.setDetails.length : (ex.sets ?? 0);
      if (setCount <= 0) continue;

      totals[section] += setCount;
      resolvedAny = true;
    }
    if (resolvedAny) resolvedSessions += 1;
  }

  const weeks = windowDays / 7;
  const levels = Object.fromEntries(
    SET_LEVEL_SECTIONS.map((section) => {
      const weeklySets = Math.round((totals[section] / weeks) * 10) / 10;
      const level: MuscleSetLevel = { section, weeklySets, tier: tierForWeeklySets(weeklySets) };
      return [section, level];
    })
  ) as Record<StrengthSection, MuscleSetLevel>;

  return { levels, sessionsInWindow, resolvedSessions };
}
