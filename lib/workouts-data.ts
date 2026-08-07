import {
  findExercises,
  findUserById,
  findWorkoutSessionsByUserId,
  type WorkoutExerciseEntry,
  type WorkoutRunEntry,
} from "./db";
import { computePersonalBests, type PersonalBest } from "./workouts";

export interface WorkoutSessionSummary {
  id: string;
  date: string;
  title: string;
  durationMins: number | null;
  notes: string | null;
  exercises: WorkoutExerciseEntry[];
  runs: WorkoutRunEntry[];
}

export interface ExerciseLibraryEntry {
  id: string;
  name: string;
  section: string;
}

export interface WorkoutsData {
  sessions: WorkoutSessionSummary[];
  personalBests: PersonalBest[];
  // Feeds the mobile logging form's exercise autocomplete (see
  // app/(dashboard)/dashboard/workouts/shared/ExerciseAutocomplete.tsx for
  // the web equivalent) and the trend chart's exercise picker.
  exerciseLibrary: ExerciseLibraryEntry[];
}

// Full session history (exercises + runs, not just names) so the mobile app
// can compute personal bests, per-exercise trend charts, and render
// per-set detail entirely client-side — same data the web app already
// loads. Submitting new sessions goes through the existing
// /api/workouts/create endpoint (already Bearer-compatible).
export function getWorkoutsData(userId: string | undefined): WorkoutsData | null {
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return null;

  const sessions = findWorkoutSessionsByUserId(user.id);
  const personalBests = computePersonalBests(sessions);

  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      date: s.date,
      title: s.title,
      durationMins: s.durationMins,
      notes: s.notes,
      exercises: s.exercises,
      runs: s.runs,
    })),
    personalBests,
    exerciseLibrary: findExercises().map((e) => ({ id: e.id, name: e.name, section: e.section })),
  };
}
