import { exerciseMatchesEquipmentSlugs } from "./equipment-matching";
import type { ExerciseLibraryRecord } from "./exercise-library/types";
import type { PrescribedExercise } from "./db";
import {
  bodyHalfOfBucket,
  classifyMovementBucket,
  isCompoundExercise,
  MAIN_MOVEMENT_BUCKETS,
  type MainMovementBucket,
  type MovementBucket,
} from "./movement-buckets";

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

// ---------------------------------------------------------------------------
// Structured (compound-first, alternating-antagonist) picker — the default
// template for both the Programme Builder and the ad-hoc Workout Generator.
// Unlike pickExercisesForDay above (still used for "freeform" — the AI's own
// free body-part balance for goal === "Build muscle", or a member's manual
// muscle-area picks in the ad-hoc generator), this never asks for body
// parts — it always draws from the 4 main movement-pattern buckets (or just
// 2, for an Upper/Lower day) plus a tempo and a core finisher, classified
// straight from each exercise's existing `taxonomy` (see movement-buckets.ts
// for why no new data/migration is needed for this).

export type SplitMode = "fullBody" | "upperLower" | "freeform";

export interface StructuredDaySpec {
  mode: "fullBody" | "upperLower";
  /** Required and only meaningful when mode === "upperLower". */
  half?: "upper" | "lower";
}

export interface PickStructuredExercisesForDayInput {
  exercises: ExerciseLibraryRecord[];
  daySpec: StructuredDaySpec;
  equipmentSlugs: string[];
  timeMinutes: number;
  /** Shared across every day in one generation, same convention as
      pickExercisesForDay's alreadyChosenIds. */
  alreadyChosenIds?: Set<string>;
}

interface BucketPool {
  compound: ExerciseLibraryRecord[];
  other: ExerciseLibraryRecord[];
}

function takeFromBucketPool(pool: BucketPool, alreadyChosen: Set<string>): ExerciseLibraryRecord | null {
  while (pool.compound.length > 0) {
    const candidate = pool.compound.shift()!;
    if (!alreadyChosen.has(candidate.id)) {
      alreadyChosen.add(candidate.id);
      return candidate;
    }
  }
  while (pool.other.length > 0) {
    const candidate = pool.other.shift()!;
    if (!alreadyChosen.has(candidate.id)) {
      alreadyChosen.add(candidate.id);
      return candidate;
    }
  }
  return null;
}

// Cycles through bucketSequence, taking one exercise per turn, until `slots`
// are filled or every bucket in the cycle has run dry — a bucket that's
// exhausted just quietly contributes nothing on its turns, so demand
// naturally spills onto whichever buckets in the cycle still have supply
// (same round-robin-with-spillover shape as pickForBodyParts above).
function pickAlongBucketSequence(
  bucketSequence: MovementBucket[],
  slots: number,
  pools: Map<MovementBucket, BucketPool>,
  alreadyChosen: Set<string>
): ExerciseLibraryRecord[] {
  if (bucketSequence.length === 0) return [];
  const picked: ExerciseLibraryRecord[] = [];
  let idx = 0;
  let emptyStreak = 0;
  while (picked.length < slots && emptyStreak < bucketSequence.length) {
    const bucket = bucketSequence[idx % bucketSequence.length];
    idx++;
    const pool = pools.get(bucket);
    const candidate = pool ? takeFromBucketPool(pool, alreadyChosen) : null;
    if (candidate) {
      picked.push(candidate);
      emptyStreak = 0;
    } else {
      emptyStreak++;
    }
  }
  return picked;
}

// Session-length -> (main-slot count, finisher buckets) — see the plan's
// scaling table. totalSlots <= 3 has no room for a finisher; 4 "periodically"
// (1-in-3) trades its last main slot for one finisher; 5 always gets exactly
// one finisher (whichever fits); 6+ always gets both, pinned last.
function resolveStructuredSlotPlan(totalSlots: number): { mainCount: number; finishers: MovementBucket[] } {
  if (totalSlots <= 3) return { mainCount: totalSlots, finishers: [] };
  if (totalSlots === 4) {
    if (Math.random() < 1 / 3) {
      return { mainCount: 3, finishers: [Math.random() < 0.5 ? "tempo" : "core"] };
    }
    return { mainCount: 4, finishers: [] };
  }
  if (totalSlots === 5) {
    return { mainCount: 4, finishers: [Math.random() < 0.5 ? "tempo" : "core"] };
  }
  return { mainCount: totalSlots - 2, finishers: ["tempo", "core"] };
}

// Builds the cyclable main-bucket order: strict upper/lower alternation,
// covering all available main buckets once per cycle, with no fixed leader
// ("starting in any order" per the member's own spec) — just randomized
// which half and which push/pull leads.
function buildMainBucketSequence(mainBuckets: MainMovementBucket[], mode: "fullBody" | "upperLower"): MainMovementBucket[] {
  if (mode === "upperLower") return shuffled(mainBuckets);

  const upper = shuffled(mainBuckets.filter((b) => bodyHalfOfBucket(b) === "upper"));
  const lower = shuffled(mainBuckets.filter((b) => bodyHalfOfBucket(b) === "lower"));
  const startHalf: "upper" | "lower" = Math.random() < 0.5 ? "upper" : "lower";

  const sequence: MainMovementBucket[] = [];
  for (let i = 0; i < Math.max(upper.length, lower.length); i++) {
    const first = startHalf === "upper" ? upper[i] : lower[i];
    const second = startHalf === "upper" ? lower[i] : upper[i];
    if (first) sequence.push(first);
    if (second) sequence.push(second);
  }
  return sequence;
}

export function resolveSplitMode(goal: string, splitPreference: "fullBody" | "upperLower" | null): SplitMode {
  // "Build muscle" is the closest existing goal preset to bodybuilding/
  // aesthetics work, which genuinely wants isolation-heavy, freely-split
  // days rather than every session being compound-first full body —
  // matches the exact-string-match precedent already used for the sports
  // goal check in the mobile Workout Generator.
  if (goal === "Build muscle") return "freeform";
  return splitPreference ?? "fullBody";
}

export function pickStructuredExercisesForDay(input: PickStructuredExercisesForDayInput): PrescribedExercise[] {
  const { exercises, daySpec, equipmentSlugs, timeMinutes } = input;
  const alreadyChosen = input.alreadyChosenIds ?? new Set<string>();

  const eligible = exercises.filter((e) => exerciseMatchesEquipmentSlugs(e.equipment, equipmentSlugs));

  const pools = new Map<MovementBucket, BucketPool>();
  for (const e of eligible) {
    const bucket = classifyMovementBucket(e.taxonomy);
    if (!bucket) continue;
    const pool = pools.get(bucket) ?? { compound: [], other: [] };
    if (isCompoundExercise(e.taxonomy)) pool.compound.push(e);
    else pool.other.push(e);
    pools.set(bucket, pool);
  }
  for (const pool of pools.values()) {
    pool.compound = shuffled(pool.compound);
    pool.other = shuffled(pool.other);
  }

  const mainBuckets =
    daySpec.mode === "upperLower" ? MAIN_MOVEMENT_BUCKETS.filter((b) => bodyHalfOfBucket(b) === daySpec.half) : MAIN_MOVEMENT_BUCKETS;

  const timeBasedSlots = Math.min(MAX_EXERCISES, Math.max(MIN_EXERCISES, Math.round(timeMinutes / MINUTES_PER_EXERCISE)));
  const { mainCount, finishers } = resolveStructuredSlotPlan(timeBasedSlots);

  const mainSequence = buildMainBucketSequence(mainBuckets, daySpec.mode);
  const mainPicks = pickAlongBucketSequence(mainSequence, mainCount, pools, alreadyChosen);

  const finisherPicks = finishers.flatMap((bucket) => pickAlongBucketSequence([bucket], 1, pools, alreadyChosen));

  const picks = [...mainPicks, ...finisherPicks];

  // Total starvation (extreme equipment restriction leaves every bucket
  // empty) — fall back to the freeform body-part picker across every body
  // part so the day is never handed back empty, same philosophy as this
  // file's other picker.
  if (picks.length === 0) {
    const fallbackBodyParts = [...new Set(exercises.map((e) => e.bodyPart).filter((v): v is string => !!v))];
    return pickExercisesForDay({
      exercises,
      primaryBodyParts: fallbackBodyParts,
      secondaryBodyParts: [],
      equipmentSlugs,
      timeMinutes,
      alreadyChosenIds: alreadyChosen,
    });
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
