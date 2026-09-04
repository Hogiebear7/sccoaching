import { randomUUID } from "crypto";

import {
  findAllTrainingPrograms,
  findProfileByUserId,
  findTrainingProgramsByUserId,
  findUserById,
  saveTrainingProgram,
  type PrescribedExercise,
  type PrescribedSet,
  type ProgramDayRecord,
  type ProgramDayType,
  type TrainingProgramRecord,
  type WorkoutSessionRecord,
  type WorkoutSetType,
} from "./db";
import type { ProgrammeSkeletonCheckpoint } from "./ai";
import { removeSyncedProgrammeSessions } from "./programme-weekly-sync";
import { buildHistoryIndex, formatKg, latestEntryForOption, roundToStep, type SessionTier } from "./workout-helper";

const SET_TYPES: WorkoutSetType[] = ["standard", "warmup", "dropset", "myoset", "failure", "partial"];
const DAY_TYPES: ProgramDayType[] = ["workout", "rest"];

function parseSetType(value: unknown): WorkoutSetType | null {
  return typeof value === "string" && SET_TYPES.includes(value as WorkoutSetType) ? (value as WorkoutSetType) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parsePrescribedSets(input: unknown): PrescribedSet[] | null {
  if (!Array.isArray(input)) return null;
  const sets = input.slice(0, 20).map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return { reps: str(s.reps), weight: str(s.weight), setType: parseSetType(s.setType) } satisfies PrescribedSet;
  });
  return sets.length > 0 ? sets : null;
}

export function parsePrescribedExercises(input: unknown): PrescribedExercise[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const name = str(e.name);
    if (!name) return [];

    const targetSetsRaw = typeof e.targetSets === "number" ? e.targetSets : null;

    return [
      {
        id: str(e.id) ?? randomUUID(),
        exerciseId: str(e.exerciseId),
        name,
        muscleTags: Array.isArray(e.muscleTags)
          ? e.muscleTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim()).slice(0, 8)
          : [],
        targetSets: targetSetsRaw !== null && Number.isFinite(targetSetsRaw) && targetSetsRaw >= 0 ? Math.floor(targetSetsRaw) : null,
        targetReps: str(e.targetReps),
        targetWeight: str(e.targetWeight),
        setType: parseSetType(e.setType),
        sets: parsePrescribedSets(e.sets),
        supersetGroup: str(e.supersetGroup),
        notes: str(e.notes),
      } satisfies PrescribedExercise,
    ];
  });
}

export function parseProgramDays(input: unknown): { ok: true; days: ProgramDayRecord[] } | { ok: false; message: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, message: "At least one program day is required." };
  }
  if (input.length > 14) {
    return { ok: false, message: "A program can have at most 14 days." };
  }

  const days: ProgramDayRecord[] = [];

  for (const raw of input) {
    const d = (raw ?? {}) as Record<string, unknown>;
    const label = str(d.label);
    if (!label) return { ok: false, message: "Every day needs a label (e.g. \"Workout A\")." };

    const type = typeof d.type === "string" && DAY_TYPES.includes(d.type as ProgramDayType) ? (d.type as ProgramDayType) : "workout";

    days.push({
      id: str(d.id) ?? randomUUID(),
      label,
      type,
      exercises: type === "rest" ? [] : parsePrescribedExercises(d.exercises),
    });
  }

  return { ok: true, days };
}

// ── AI programme targets — creation-time seeding and cycle-over-cycle
// progressive overload. Exercises are picked once (lib/programme-exercise-
// picker.ts) and stay fixed across cycles; only these numeric targets move.

export type ProgrammeRepScheme = "strength" | "hypertrophy" | "endurance";

// The standard strength/hypertrophy/endurance rep-range convention (roughly
// 1-6 / 6-12 / 12-20+ reps) reflected across NSCA/ACSM guidance — a general,
// well-established principle, not tied to any specific cited study.
const REP_SCHEME_TARGETS: Record<ProgrammeRepScheme, { sets: number; reps: string }> = {
  strength: { sets: 4, reps: "4-6" },
  hypertrophy: { sets: 3, reps: "8-12" },
  endurance: { sets: 3, reps: "15-20" },
};

// Weight/rep step size, matching the convention already used by
// lib/workout-helper.ts's prescribeMain(): 2.5 kg above 20 kg, 1 kg below.
function stepFor(weightKg: number): number {
  return weightKg >= 20 ? 2.5 : 1;
}

// Lower bound of a "X-Y" rep-range string (e.g. "8-12" -> 8). Falls back to
// the single number if not a range, or 0 if unparseable.
function lowerRepBound(range: string): number {
  const match = range.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

// Seeds a brand-new programme day's exercise targets from the member's
// existing history (any prior session, not scoped to this programme —
// exactly the same "does the member have a relevant prior log" question
// prescribeMain() already asks). Never invents a weight: no usable history
// means targetWeight stays null and the rep scheme alone stands as an
// RPE-style target, matching the discipline already established for the
// single-workout generator and the web Workout Helper.
export function resolveInitialProgrammeTargets(
  exercises: PrescribedExercise[],
  repScheme: ProgrammeRepScheme,
  sessions: WorkoutSessionRecord[]
): PrescribedExercise[] {
  const targets = REP_SCHEME_TARGETS[repScheme];
  const history = buildHistoryIndex(sessions);

  return exercises.map((exercise) => {
    const entry = latestEntryForOption(history, exercise.name);
    return {
      ...exercise,
      targetSets: targets.sets,
      targetReps: targets.reps,
      targetWeight: entry && entry.weightNum !== null ? formatKg(entry.weightNum) : null,
    };
  });
}

// Cycle-over-cycle progressive overload. Looks only at sessions logged
// since `cycleStartedAt` (the cycle that just finished) — older history is
// what resolveInitialProgrammeTargets above already used to seed the very
// first cycle, and mixing it back in here would let a stale log from
// before the programme started drive "how did last week go."
//
// RIR/RPE-based autoregulation — a standard progressive-overload principle
// (bump load only when the prescribed reps were achievable with room to
// spare) rather than a fixed percentage-based scheme.
//
// Rule (WorkoutExerciseEntry.rir = reps in reserve, 0-5, low = near
// failure):
//   - No RIR logged for that exercise this cycle -> hold (safest default).
//   - Hit target reps, RIR >= 3 (comfortable)    -> bump weight one step.
//   - Hit target reps, RIR 0-2 (near failure)    -> hold.
//   - Missed target reps, RIR > 0                -> hold.
//   - Missed target reps, RIR 0 (failed)         -> back off ~10%.
// No matching log at all this cycle -> hold (member skipped/hasn't logged
// it yet; nothing to react to).
// The RIR bar for "comfortable enough to bump" — set by a check-in's
// accepted pace-adjustment proposal (TrainingProgramRecord.progressBias).
// Lower bar = bumps sooner (accelerate); higher bar = waits for more room
// in reserve before bumping (hold_back). Same mechanism, just retuned —
// exercise identity and content are never touched by this.
const COMFORTABLE_RIR_THRESHOLD: Record<"accelerate" | "normal" | "hold_back", number> = {
  accelerate: 2,
  normal: 3,
  hold_back: 4,
};

export function resolveNextCycleTargets(
  exercises: PrescribedExercise[],
  sessions: WorkoutSessionRecord[],
  cycleStartedAt: string | null,
  progressBias: "accelerate" | "normal" | "hold_back" = "normal"
): PrescribedExercise[] {
  const cutoff = cycleStartedAt ?? "";
  const history = buildHistoryIndex(sessions).filter((entry) => entry.date >= cutoff);
  const comfortableRir = COMFORTABLE_RIR_THRESHOLD[progressBias];

  return exercises.map((exercise) => {
    const entry = latestEntryForOption(history, exercise.name);
    if (!entry || entry.rir === null) return exercise;

    const hitTarget = entry.reps !== null && entry.reps >= lowerRepBound(exercise.targetReps ?? "");
    const hasWeight = entry.weightNum !== null;

    if (hitTarget && entry.rir >= comfortableRir) {
      if (!hasWeight) return exercise;
      const step = stepFor(entry.weightNum!);
      return { ...exercise, targetWeight: formatKg(entry.weightNum! + step) };
    }

    if (!hitTarget && entry.rir === 0) {
      if (!hasWeight) return exercise;
      const step = stepFor(entry.weightNum!);
      const lighter = Math.max(roundToStep(entry.weightNum! * 0.9, step), step);
      return { ...exercise, targetWeight: formatKg(lighter) };
    }

    // Hit with low RIR, or missed without failing outright — hold at the
    // logged weight (repeat, not a blind carry-forward of the old target).
    return { ...exercise, targetWeight: hasWeight ? formatKg(entry.weightNum!) : exercise.targetWeight };
  });
}

// Read-time-only trim for a "reduced" readiness day — never persisted (see
// app/api/mobile/programs/route.ts, which applies this to the GET response
// only). Writing a trimmed value back into the stored record would corrupt
// resolveNextCycleTargets' next comparison against the day's real
// prescription.
export function applyTierModifier(day: ProgramDayRecord, tier: SessionTier): ProgramDayRecord {
  if (tier !== "reduced" || day.type !== "workout") return day;
  return {
    ...day,
    exercises: day.exercises.map((ex) => ({
      ...ex,
      targetSets: ex.targetSets !== null ? Math.max(1, ex.targetSets - 1) : ex.targetSets,
    })),
  };
}

export interface StaffTrainingProgramSummary extends TrainingProgramRecord {
  memberEmail: string;
  memberFullName: string | null;
}

export function getStaffTrainingPrograms(userId?: string): StaffTrainingProgramSummary[] {
  const programs = userId ? findTrainingProgramsByUserId(userId) : findAllTrainingPrograms();

  return programs.map((program) => {
    const member = findUserById(program.userId);
    const profile = member ? findProfileByUserId(member.id) : undefined;
    return {
      ...program,
      memberEmail: member?.email ?? "Unknown member",
      memberFullName: profile?.fullName ?? null,
    };
  });
}

// A member has at most one active program — assigning a new active one
// archives whatever was active before it, so history stays browsable rather
// than being overwritten.
export function archiveOtherActivePrograms(userId: string, exceptId: string): void {
  for (const program of findTrainingProgramsByUserId(userId)) {
    if (program.id !== exceptId && program.status === "active") {
      saveTrainingProgram({ ...program, status: "archived", updatedAt: new Date().toISOString() });
      removeSyncedProgrammeSessions(userId, program.id);
    }
  }
}

// Deterministic, not AI-chosen — removes any hallucination risk around WHEN
// a checkpoint falls; the AI only ever decides what to test (see
// PROGRAMME_SKELETON_SYSTEM_PROMPT in lib/ai.ts). Always week 1 (baseline)
// and the final week, plus intermediate checkpoints every 4 weeks for
// anything longer: 4wk -> [1,4], 8wk -> [1,5,8], 12wk -> [1,5,9,12].
export function computeCheckpointWeeks(totalWeeks: number): number[] {
  if (totalWeeks <= 0) return [];
  const STEP = 4;
  const weeks: number[] = [];
  for (let w = 1; w <= totalWeeks; w += STEP) {
    weeks.push(w);
  }
  if (weeks[weeks.length - 1] !== totalWeeks) {
    weeks.push(totalWeeks);
  }
  return weeks;
}

// Re-validates the testCheckpoints the client echoes back from /generate's
// preview to /save — same "never trust the client" discipline as
// parseProgramDays, since a save call carries no second AI response to
// re-derive this from.
export function parseTestCheckpoints(input: unknown): TrainingProgramRecord["testCheckpoints"] {
  if (!Array.isArray(input)) return undefined;

  const checkpoints: NonNullable<TrainingProgramRecord["testCheckpoints"]> = [];
  for (const raw of input.slice(0, 6)) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const weekNumber = Number(c.weekNumber);
    if (!Number.isInteger(weekNumber) || weekNumber <= 0) continue;

    const d = (c.day ?? {}) as Record<string, unknown>;
    const label = str(d.label);
    if (!label) continue;

    const exercises = parsePrescribedExercises(d.exercises);
    if (exercises.length === 0) continue;

    checkpoints.push({
      weekNumber,
      day: { id: str(d.id) ?? randomUUID(), label, type: "test", exercises },
    });
  }

  return checkpoints.length > 0 ? checkpoints : undefined;
}

// Turns the AI's validated checkpoint proposals into real ProgramDayRecords
// (type "test") the same way a workout day is built — via
// parsePrescribedExercises, so ids/defaults are assigned identically.
// exerciseId is always null (a test protocol names its own movement in free
// text, there's no library exercise to link) and targetWeight is always
// null (a test has a protocol to perform, never a number to hit).
export function buildTestCheckpoints(
  checkpoints: ProgrammeSkeletonCheckpoint[]
): TrainingProgramRecord["testCheckpoints"] {
  return checkpoints.map((cp) => ({
    weekNumber: cp.weekNumber,
    day: {
      id: randomUUID(),
      label: cp.label,
      type: "test" as const,
      exercises: parsePrescribedExercises(
        cp.exercises.map((e) => ({ name: e.name, targetReps: e.protocol, exerciseId: null }))
      ),
    },
  }));
}

// Pure core of advanceProgramDay — no save, so it's directly unit-testable.
// For an AI-sourced programme, a wrap back to day 0 also means a full cycle
// just finished — that's the trigger point for progressive overload:
// recompute every day's targets from what was actually logged during the
// cycle that just ended, then start the clock on the next one.
export function computeAdvancedProgram(
  program: TrainingProgramRecord,
  sessions: WorkoutSessionRecord[] = []
): TrainingProgramRecord {
  const nextIndex = program.days.length > 0 ? (program.currentDayIndex + 1) % program.days.length : 0;
  const wrapped = nextIndex === 0 && program.days.length > 0;

  let days = program.days;
  let completedCycles = program.completedCycles ?? 0;
  let cycleStartedAt = program.cycleStartedAt ?? null;
  let cycleSummaries = program.cycleSummaries ?? [];

  if (wrapped && program.source === "ai") {
    days = days.map((day) => ({
      ...day,
      exercises:
        day.type === "workout"
          ? resolveNextCycleTargets(day.exercises, sessions, cycleStartedAt, program.progressBias ?? "normal")
          : day.exercises,
    }));
    const endedAt = new Date().toISOString();
    cycleSummaries = [
      ...cycleSummaries,
      { cycleIndex: completedCycles, startedAt: cycleStartedAt ?? program.createdAt, endedAt },
    ];
    completedCycles += 1;
    cycleStartedAt = endedAt;
  }

  return {
    ...program,
    days,
    currentDayIndex: nextIndex,
    completedCycles,
    cycleStartedAt,
    cycleSummaries,
    updatedAt: new Date().toISOString(),
  };
}

// Pure core of applying an accepted checkpoint adjustment proposal — no
// save, so it's directly unit-testable, same split as computeAdvancedProgram
// above. "accelerate"/"hold_back" just set progressBias (resolveNextCycle-
// Targets picks it up next wrap). "expedite_timeline" shortens totalWeeks
// and remaps any still-upcoming testCheckpoints onto the new, shorter
// schedule — already-reached checkpoints (weekNumber <= current week) are
// left exactly as they are, and the AI-authored test CONTENT of any
// remapped future checkpoint is reused as-is (only which week it lands on
// changes) rather than fabricated fresh, since there's no second AI call
// here.
export function applyProgrammeAdjustment(
  program: TrainingProgramRecord,
  type: "accelerate" | "hold_back" | "expedite_timeline",
  proposedTotalWeeks?: number
): TrainingProgramRecord {
  if (type === "accelerate" || type === "hold_back") {
    return { ...program, progressBias: type, updatedAt: new Date().toISOString() };
  }

  // expedite_timeline
  if (!proposedTotalWeeks || proposedTotalWeeks <= 0) return program;

  const currentWeek = (program.completedCycles ?? 0) + 1;
  const newCheckpointWeeks = computeCheckpointWeeks(proposedTotalWeeks).filter((w) => w > currentWeek);

  const pastCheckpoints = (program.testCheckpoints ?? []).filter((c) => c.weekNumber <= currentWeek);
  const futureCheckpoints = (program.testCheckpoints ?? []).filter((c) => c.weekNumber > currentWeek);
  const remapped = futureCheckpoints
    .slice(0, newCheckpointWeeks.length)
    .map((c, i) => ({ ...c, weekNumber: newCheckpointWeeks[i] }));

  return {
    ...program,
    totalWeeks: proposedTotalWeeks,
    testCheckpoints: [...pastCheckpoints, ...remapped].sort((a, b) => a.weekNumber - b.weekNumber),
    updatedAt: new Date().toISOString(),
  };
}

// Advances the member's cursor to the next day (wrapping to the start),
// called when they mark the current day's workout complete.
export function advanceProgramDay(program: TrainingProgramRecord, sessions?: WorkoutSessionRecord[]): TrainingProgramRecord {
  const updated = computeAdvancedProgram(program, sessions ?? []);
  saveTrainingProgram(updated);
  return updated;
}
