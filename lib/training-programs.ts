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
// Rule (WorkoutExerciseEntry.rir = reps in reserve, 0-5, low = near
// failure):
//   - No RIR logged for that exercise this cycle -> hold (safest default).
//   - Hit target reps, RIR >= 3 (comfortable)    -> bump weight one step.
//   - Hit target reps, RIR 0-2 (near failure)    -> hold.
//   - Missed target reps, RIR > 0                -> hold.
//   - Missed target reps, RIR 0 (failed)         -> back off ~10%.
// No matching log at all this cycle -> hold (member skipped/hasn't logged
// it yet; nothing to react to).
export function resolveNextCycleTargets(
  exercises: PrescribedExercise[],
  sessions: WorkoutSessionRecord[],
  cycleStartedAt: string | null
): PrescribedExercise[] {
  const cutoff = cycleStartedAt ?? "";
  const history = buildHistoryIndex(sessions).filter((entry) => entry.date >= cutoff);

  return exercises.map((exercise) => {
    const entry = latestEntryForOption(history, exercise.name);
    if (!entry || entry.rir === null) return exercise;

    const hitTarget = entry.reps !== null && entry.reps >= lowerRepBound(exercise.targetReps ?? "");
    const hasWeight = entry.weightNum !== null;

    if (hitTarget && entry.rir >= 3) {
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
    }
  }
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

  if (wrapped && program.source === "ai") {
    days = days.map((day) => ({
      ...day,
      exercises:
        day.type === "workout" ? resolveNextCycleTargets(day.exercises, sessions, cycleStartedAt) : day.exercises,
    }));
    completedCycles += 1;
    cycleStartedAt = new Date().toISOString();
  }

  return {
    ...program,
    days,
    currentDayIndex: nextIndex,
    completedCycles,
    cycleStartedAt,
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
