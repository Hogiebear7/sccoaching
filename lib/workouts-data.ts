import { findUserById, findWorkoutSessionsByUserId } from "./db";
import { computePersonalBests, type PersonalBest } from "./workouts";

export interface WorkoutSessionSummary {
  id: string;
  date: string;
  title: string;
  durationMins: number | null;
  notes: string | null;
  exerciseCount: number;
  exerciseNames: string[];
}

export interface WorkoutsData {
  sessions: WorkoutSessionSummary[];
  personalBests: PersonalBest[];
}

// Mobile-first MVP of the Workouts tab: session history + personal bests
// (read-only). The web WorkoutsView additionally has a full live logging
// form (exercise autocomplete, set-level editor, trend charts, class-session
// sync) — that's a separate, larger mobile build; this covers "review what
// I've done" while that catches up.
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
      exerciseCount: s.exercises.length,
      exerciseNames: s.exercises.map((e) => e.name),
    })),
    personalBests,
  };
}
