import type { WorkoutSessionRecord } from "@/lib/db";

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
  heaviestWeight: { weightStr: string; value: number; date: string } | null;
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
      heaviest: { value: number; weightStr: string; date: string } | null;
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

      if (ex.weight) {
        const num = parseFloat(ex.weight);
        if (Number.isFinite(num) && (group.heaviest === null || num > group.heaviest.value)) {
          group.heaviest = { value: num, weightStr: ex.weight, date: session.date };
        }
      }

      if (ex.reps !== null && (group.highestReps === null || ex.reps > group.highestReps.reps)) {
        group.highestReps = { reps: ex.reps, date: session.date };
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
