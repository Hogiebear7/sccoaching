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
  type WorkoutSetType,
} from "./db";

const SET_TYPES: WorkoutSetType[] = ["standard", "dropset", "myoset", "failure", "partial"];
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

// Advances the member's cursor to the next day (wrapping to the start),
// called when they mark the current day's workout complete.
export function advanceProgramDay(program: TrainingProgramRecord): TrainingProgramRecord {
  const nextIndex = program.days.length > 0 ? (program.currentDayIndex + 1) % program.days.length : 0;
  const updated: TrainingProgramRecord = { ...program, currentDayIndex: nextIndex, updatedAt: new Date().toISOString() };
  saveTrainingProgram(updated);
  return updated;
}
