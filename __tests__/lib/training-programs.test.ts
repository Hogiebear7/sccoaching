import { describe, expect, it } from "vitest";

import type { PrescribedExercise, TrainingProgramRecord, WorkoutSessionRecord } from "@/lib/db";
import {
  applyTierModifier,
  computeAdvancedProgram,
  parseProgramDays,
  resolveInitialProgrammeTargets,
  resolveNextCycleTargets,
} from "@/lib/training-programs";

function makeSession(
  date: string,
  exercises: { name: string; weight: string | null; reps: number | null; sets: number | null; rir?: number | null }[]
): WorkoutSessionRecord {
  return {
    id: `session-${date}`,
    userId: "user-1",
    date,
    title: "Test session",
    durationMins: 60,
    notes: null,
    exercises: exercises.map((ex) => ({
      exerciseId: null,
      name: ex.name,
      weight: ex.weight,
      reps: ex.reps,
      sets: ex.sets,
      rir: ex.rir ?? null,
      notes: null,
    })),
    runs: [],
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
  };
}

function makeExercise(overrides: Partial<PrescribedExercise> = {}): PrescribedExercise {
  return {
    id: "ex-1",
    exerciseId: "lib-1",
    name: "Back Squat",
    muscleTags: ["upper legs"],
    targetSets: 3,
    targetReps: "8-12",
    targetWeight: null,
    setType: null,
    sets: null,
    supersetGroup: null,
    notes: null,
    ...overrides,
  };
}

function makeProgram(overrides: Partial<TrainingProgramRecord> = {}): TrainingProgramRecord {
  return {
    id: "prog-1",
    userId: "user-1",
    name: "Test Programme",
    status: "active",
    days: [
      { id: "day-1", label: "Day A", type: "workout", exercises: [makeExercise()] },
      { id: "day-2", label: "Day B", type: "workout", exercises: [makeExercise({ id: "ex-2", name: "Bench Press" })] },
    ],
    currentDayIndex: 0,
    createdByStaffId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "ai",
    totalWeeks: 8,
    completedCycles: 0,
    cycleStartedAt: "2026-01-01T00:00:00.000Z",
    aiMeta: null,
    ...overrides,
  };
}

describe("resolveInitialProgrammeTargets", () => {
  it("anchors to the last logged weight when relevant history exists, never inventing one", () => {
    const sessions = [makeSession("2026-01-01", [{ name: "Back Squat", weight: "80", reps: 10, sets: 3 }])];
    const [ex] = resolveInitialProgrammeTargets([makeExercise()], "hypertrophy", sessions);
    expect(ex.targetWeight).toBe("80 kg");
    expect(ex.targetSets).toBe(3);
    expect(ex.targetReps).toBe("8-12");
  });

  it("leaves weight null with no relevant history — RPE-style target only", () => {
    const [ex] = resolveInitialProgrammeTargets([makeExercise()], "strength", []);
    expect(ex.targetWeight).toBeNull();
    expect(ex.targetSets).toBe(4);
    expect(ex.targetReps).toBe("4-6");
  });
});

describe("resolveNextCycleTargets", () => {
  const cycleStart = "2026-02-01T00:00:00.000Z";

  it("holds when no RIR was logged this cycle", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 12, sets: 3, rir: null }])];
    const [ex] = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg" })], sessions, cycleStart);
    expect(ex.targetWeight).toBe("80 kg");
  });

  it("bumps weight when target reps were hit comfortably (RIR >= 3)", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 12, sets: 3, rir: 4 }])];
    const [ex] = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg" })], sessions, cycleStart);
    expect(ex.targetWeight).toBe("82.5 kg");
  });

  it("holds when target reps were hit but near failure (RIR 0-2)", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 12, sets: 3, rir: 1 }])];
    const [ex] = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg" })], sessions, cycleStart);
    expect(ex.targetWeight).toBe("80 kg");
  });

  it("holds when reps were missed without failing outright (RIR > 0)", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 5, sets: 3, rir: 1 }])];
    const [ex] = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg", targetReps: "8-12" })], sessions, cycleStart);
    expect(ex.targetWeight).toBe("80 kg");
  });

  it("backs off when reps were missed and the set was failed (RIR 0)", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 5, sets: 3, rir: 0 }])];
    const [ex] = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg", targetReps: "8-12" })], sessions, cycleStart);
    expect(ex.targetWeight).toBe("72.5 kg");
  });

  it("ignores history from before the current cycle started", () => {
    const sessions = [makeSession("2026-01-15", [{ name: "Back Squat", weight: "80", reps: 12, sets: 3, rir: 5 }])];
    const [ex] = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg" })], sessions, cycleStart);
    expect(ex.targetWeight).toBe("80 kg");
  });
});

describe("applyTierModifier", () => {
  it("trims a set on a reduced-tier day without mutating the input", () => {
    const day = { id: "day-1", label: "Day A", type: "workout" as const, exercises: [makeExercise({ targetSets: 3 })] };
    const trimmed = applyTierModifier(day, "reduced");
    expect(trimmed.exercises[0].targetSets).toBe(2);
    expect(day.exercises[0].targetSets).toBe(3);
  });

  it("leaves full/standard tiers and rest days untouched", () => {
    const day = { id: "day-1", label: "Day A", type: "workout" as const, exercises: [makeExercise({ targetSets: 3 })] };
    expect(applyTierModifier(day, "full").exercises[0].targetSets).toBe(3);
    expect(applyTierModifier(day, "standard").exercises[0].targetSets).toBe(3);
    const rest = { id: "day-2", label: "Rest", type: "rest" as const, exercises: [] };
    expect(applyTierModifier(rest, "reduced")).toEqual(rest);
  });
});

describe("computeAdvancedProgram", () => {
  it("advances currentDayIndex without wrapping mid-week", () => {
    const updated = computeAdvancedProgram(makeProgram({ currentDayIndex: 0 }));
    expect(updated.currentDayIndex).toBe(1);
    expect(updated.completedCycles).toBe(0);
  });

  it("wraps, increments completedCycles, and recomputes targets only for source:'ai' on wrap", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 12, sets: 3, rir: 4 }])];
    const program = makeProgram({ currentDayIndex: 1, cycleStartedAt: "2026-02-01T00:00:00.000Z" });
    const updated = computeAdvancedProgram(program, sessions);
    expect(updated.currentDayIndex).toBe(0);
    expect(updated.completedCycles).toBe(1);
    expect(updated.cycleStartedAt).not.toBe(program.cycleStartedAt);
    expect(updated.days[0].exercises[0].targetWeight).toBe("82.5 kg");
  });

  it("does not recompute targets for a staff-assigned program on wrap", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 12, sets: 3, rir: 4 }])];
    const program = makeProgram({ currentDayIndex: 1, source: "staff" });
    const updated = computeAdvancedProgram(program, sessions);
    expect(updated.currentDayIndex).toBe(0);
    expect(updated.completedCycles).toBe(0);
    expect(updated.days[0].exercises[0].targetWeight).toBeNull();
  });
});

describe("parseProgramDays", () => {
  it("rejects an empty or non-array day list", () => {
    expect(parseProgramDays(null)).toEqual({ ok: false, message: "At least one program day is required." });
    expect(parseProgramDays([])).toEqual({ ok: false, message: "At least one program day is required." });
  });

  it("rejects more than 14 days", () => {
    const days = Array.from({ length: 15 }, (_, i) => ({ label: `Day ${i}` }));
    const result = parseProgramDays(days);
    expect(result).toEqual({ ok: false, message: "A program can have at most 14 days." });
  });

  it("requires a label on every day", () => {
    const result = parseProgramDays([{ label: "Workout A" }, { label: "" }]);
    expect(result).toEqual({ ok: false, message: 'Every day needs a label (e.g. "Workout A").' });
  });

  it("defaults an unrecognized type to workout and rest days drop exercises", () => {
    const result = parseProgramDays([
      { label: "Workout A", type: "bogus", exercises: [{ name: "Bench Press" }] },
      { label: "Rest", type: "rest", exercises: [{ name: "Should be dropped" }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0].type).toBe("workout");
    expect(result.days[0].exercises).toHaveLength(1);
    expect(result.days[1].type).toBe("rest");
    expect(result.days[1].exercises).toEqual([]);
  });

  it("parses prescribed exercises including per-set breakdown, tags, and superset group; drops nameless rows", () => {
    const result = parseProgramDays([
      {
        label: "Workout A",
        exercises: [
          {
            name: "Bench Press",
            muscleTags: ["Chest", "Triceps", 42],
            targetSets: 4,
            targetReps: "8-10",
            setType: "failure",
            supersetGroup: "ss-0",
            sets: [
              { reps: "10", weight: "60kg", setType: "standard" },
              { reps: "8", weight: "70kg", setType: "dropset" },
            ],
          },
          { name: "" },
        ],
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [ex] = result.days[0].exercises;
    expect(result.days[0].exercises).toHaveLength(1);
    expect(ex.name).toBe("Bench Press");
    expect(ex.muscleTags).toEqual(["Chest", "Triceps"]);
    expect(ex.targetSets).toBe(4);
    expect(ex.targetReps).toBe("8-10");
    expect(ex.setType).toBe("failure");
    expect(ex.supersetGroup).toBe("ss-0");
    expect(ex.sets).toEqual([
      { reps: "10", weight: "60kg", setType: "standard" },
      { reps: "8", weight: "70kg", setType: "dropset" },
    ]);
  });

  it("rejects an unknown set type rather than passing it through", () => {
    const result = parseProgramDays([
      { label: "Workout A", exercises: [{ name: "Row", setType: "not-a-real-type" }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0].exercises[0].setType).toBeNull();
  });
});
