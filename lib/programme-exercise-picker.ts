import { exerciseMatchesEquipmentSlugs } from "./equipment-matching";
import type { ExerciseLibraryRecord } from "./exercise-library/types";
import type { PrescribedExercise } from "./db";

// Server-side port of sc-coaching-mobile/src/lib/workout-generator.ts's
// generateWorkout() — same bucket-by-body-part, round-robin-across-groups
// picker, so an AI-generated programme's day exercises come from the same
// real, equipment-tagged exercise library the single-workout Generate mode
// already uses (not the small ~30-name catalogue in lib/workout-helper.ts,
// which is a different, coarser list built for the staff-facing tool).
// Duplicated rather than shared because there's no package boundary between
// the two repos to share it through — same precedent as
// lib/equipment-matching.ts, whose own header documents mirroring
// lib/member-access.ts the same way.

const MINUTES_PER_EXERCISE = 8;
const MIN_EXERCISES = 1;
const MAX_EXERCISES = 10;
const PRIMARY_SHARE = 0.7;

export interface ProgrammeDaySpec {
  primaryBodyParts: string[];
  secondaryBodyParts: string[];
}

export interface PickExercisesForDayInput extends ProgrammeDaySpec {
  exercises: ExerciseLibraryRecord[];
  equipmentSlugs: string[];
  timeMinutes: number;
  /** Shared across every day in one programme generation so the same
      exercise isn't picked twice across the week — pass the same Set into
      every call and it accumulates. Fresh Set() if omitted. */
  alreadyChosenIds?: Set<string>;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Distributes `slots` picks across `bodyParts` round-robin, skipping
// exercises already chosen and body parts with nothing left to offer —
// remaining slots spill to whichever group still has candidates.
function pickForBodyParts(
  bodyParts: string[],
  slots: number,
  candidatesByBodyPart: Map<string, ExerciseLibraryRecord[]>,
  alreadyChosen: Set<string>
): ExerciseLibraryRecord[] {
  const picked: ExerciseLibraryRecord[] = [];
  const pools = new Map(bodyParts.map((bp) => [bp, shuffled(candidatesByBodyPart.get(bp) ?? [])]));

  let madeProgress = true;
  while (picked.length < slots && madeProgress) {
    madeProgress = false;
    for (const bp of bodyParts) {
      if (picked.length >= slots) break;
      const pool = pools.get(bp);
      if (!pool) continue;
      while (pool.length > 0) {
        const candidate = pool.shift()!;
        if (alreadyChosen.has(candidate.id)) continue;
        alreadyChosen.add(candidate.id);
        picked.push(candidate);
        madeProgress = true;
        break;
      }
    }
  }

  return picked;
}

// Picks exercises for one programme day. Targets (sets/reps) are left for
// the caller to fill in (resolveInitialProgrammeTargets in
// lib/training-programs.ts) — this function only ever decides WHICH
// exercises, never a weight or rep target, matching the "never invent a
// number" discipline shared with buildWorkoutPlan() and mobile's
// generateWorkout().
export function pickExercisesForDay(input: PickExercisesForDayInput): PrescribedExercise[] {
  const { exercises, primaryBodyParts, secondaryBodyParts, equipmentSlugs, timeMinutes } = input;
  const alreadyChosen = input.alreadyChosenIds ?? new Set<string>();

  const candidatesByBodyPart = new Map<string, ExerciseLibraryRecord[]>();
  for (const e of exercises) {
    if (!e.bodyPart || !exerciseMatchesEquipmentSlugs(e.equipment, equipmentSlugs)) continue;
    const list = candidatesByBodyPart.get(e.bodyPart) ?? [];
    list.push(e);
    candidatesByBodyPart.set(e.bodyPart, list);
  }

  const timeBasedSlots = Math.min(MAX_EXERCISES, Math.max(MIN_EXERCISES, Math.round(timeMinutes / MINUTES_PER_EXERCISE)));
  const primarySlots = secondaryBodyParts.length > 0 ? Math.ceil(timeBasedSlots * PRIMARY_SHARE) : timeBasedSlots;
  const secondarySlots = timeBasedSlots - primarySlots;

  const primaryPicks = pickForBodyParts(primaryBodyParts, primarySlots, candidatesByBodyPart, alreadyChosen);
  const secondaryPicks =
    secondarySlots > 0 ? pickForBodyParts(secondaryBodyParts, secondarySlots, candidatesByBodyPart, alreadyChosen) : [];

  let picks = [...primaryPicks, ...secondaryPicks];
  if (picks.length < timeBasedSlots) {
    const remaining = timeBasedSlots - picks.length;
    const fallbackBodyParts = [...primaryBodyParts, ...secondaryBodyParts];
    picks = [...picks, ...pickForBodyParts(fallbackBodyParts, remaining, candidatesByBodyPart, alreadyChosen)];
  }

  return picks.map((e) => ({
    id: e.id,
    exerciseId: e.id,
    name: e.name,
    muscleTags: e.bodyPart ? [e.bodyPart] : [],
    targetSets: null,
    targetReps: null,
    targetWeight: null,
    setType: null,
    sets: null,
    supersetGroup: null,
    notes: null,
  }));
}
