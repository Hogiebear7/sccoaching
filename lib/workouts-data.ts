import {
  findExercises,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
  type WorkoutExerciseEntry,
  type WorkoutRunEntry,
} from "./db";
import { computePersonalBests, type PersonalBest } from "./workouts";
import { FREE_HISTORY_DAYS, freeHistoryStartDate, hasAccess } from "./member-access";
import { resolveMemberAccessForUser } from "./membership-entitlement";

export interface WorkoutSessionSummary {
  id: string;
  date: string;
  title: string;
  durationMins: number | null;
  notes: string | null;
  exercises: WorkoutExerciseEntry[];
  runs: WorkoutRunEntry[];
  /** Set when synced from a class — self-logged edits go through
      /api/workouts/edit, class-synced sessions through their own
      same-day correction path (see WorkoutSessionRecord). */
  classId: string | null;
  /** Hides this session from the member's followers' Community feed — see
      app/api/mobile/workouts/[id]/visibility/route.ts. */
  isPrivate: boolean;
}

export interface ExerciseLibraryEntry {
  id: string;
  name: string;
  section: string;
}

export interface WorkoutsData {
  /** Days of history included for a Free member (sessions and bests are limited to them), or null for full history. */
  historyLimitedToDays: number | null;
  sessions: WorkoutSessionSummary[];
  personalBests: PersonalBest[];
  // Feeds the mobile logging form's exercise autocomplete (see
  // app/(dashboard)/dashboard/workouts/shared/ExerciseAutocomplete.tsx for
  // the web equivalent) and the trend chart's exercise picker.
  exerciseLibrary: ExerciseLibraryEntry[];
  // Up to 5 exercise names the member chose to feature on their Personal
  // Bests card, in pick order — see /api/profile/pinned-exercises. Empty
  // until the member curates their own list.
  pinnedExercises: string[];
  // Up to 3 exercise names pinned for quick-view on the Progression chart,
  // in pick order — see /api/profile/pinned-progression-exercises. Separate
  // from pinnedExercises since the two cards serve different purposes.
  pinnedProgressionExercises: string[];
}

// Full session history (exercises + runs, not just names) so the mobile app
// can compute personal bests, per-exercise trend charts, and render
// per-set detail entirely client-side — same data the web app already
// loads. Submitting new sessions goes through the existing
// /api/workouts/create endpoint (already Bearer-compatible).
export function getWorkoutsData(userId: string | undefined): WorkoutsData | null {
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return null;

  const allSessions = findWorkoutSessionsByUserId(user.id);
  // Free tier: history, trends and personal bests cover the last FREE_HISTORY_DAYS days (owner decision 2026-10-27). Bests are still worked out
  // from everything logged, so a Free member's best is a true best; they just see the ones set in that window. Nothing is deleted: upgrading
  // shows the full history again.
  const fullHistory = hasAccess(resolveMemberAccessForUser(user.id), "fullHistory");
  const since = freeHistoryStartDate();
  const sessions = fullHistory ? allSessions : allSessions.filter((s) => s.date >= since);
  const personalBests = fullHistory
    ? computePersonalBests(allSessions)
    : computePersonalBests(allSessions)
        .map((pb) => ({
          ...pb,
          heaviestWeight: pb.heaviestWeight && pb.heaviestWeight.date >= since ? pb.heaviestWeight : null,
          highestReps: pb.highestReps && pb.highestReps.date >= since ? pb.highestReps : null,
        }))
        .filter((pb) => pb.heaviestWeight || pb.highestReps);
  const profile = findProfileByUserId(user.id);

  return {
    historyLimitedToDays: fullHistory ? null : FREE_HISTORY_DAYS,
    sessions: sessions.map((s) => ({
      id: s.id,
      date: s.date,
      title: s.title,
      durationMins: s.durationMins,
      notes: s.notes,
      exercises: s.exercises,
      runs: s.runs,
      classId: s.classId ?? null,
      isPrivate: s.isPrivate ?? false,
    })),
    personalBests,
    exerciseLibrary: findExercises().map((e) => ({ id: e.id, name: e.name, section: e.section })),
    pinnedExercises: profile?.pinnedExercises ?? [],
    pinnedProgressionExercises: profile?.pinnedProgressionExercises ?? [],
  };
}
