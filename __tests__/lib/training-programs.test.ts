import { describe, expect, it } from "vitest";

import type { PrescribedExercise, TrainingProgramRecord, WorkoutSessionRecord } from "@/lib/db";
import type { ExerciseLibraryRecord } from "@/lib/exercise-library/types";
import {
  applyExerciseRefresh,
  applyProgrammeAdjustment,
  applyTierModifier,
  buildExerciseAlternativeCandidates,
  buildTestCheckpoints,
  computeAdvancedProgram,
  computeCheckpointWeeks,
  isExerciseRefreshEligible,
  parseProgramDays,
  parseTestCheckpoints,
  replaceProgramDayExercise,
  resolveInitialProgrammeTargets,
  resolveNextCycleTargets,
  resolveProgramStatusTransition,
} from "@/lib/training-programs";

function makeLibraryExercise(overrides: Partial<ExerciseLibraryRecord> = {}): ExerciseLibraryRecord {
  return {
    id: overrides.id ?? "lib-1",
    source: "test",
    sourceId: null,
    slug: overrides.id ?? "lib-1",
    name: overrides.name ?? "Test Exercise",
    aliases: [],
    bodyPart: overrides.bodyPart ?? "upper legs",
    targetMuscle: null,
    secondaryMuscles: [],
    equipment: overrides.equipment ?? null,
    category: null,
    difficulty: null,
    description: null,
    instructions: [],
    taxonomy: null,
    isCustom: false,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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

  it("leaves a conditioning-protocol exercise completely untouched", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "400m Repeats", weight: "80", reps: 12, sets: 3, rir: 4 }])];
    const protocolExercise = makeExercise({
      name: "400m Repeats",
      targetWeight: null,
      conditioningProtocol: { structure: "intervals", reps: 6, distanceMeters: 400, description: "Recover fully." },
    });
    const [ex] = resolveNextCycleTargets([protocolExercise], sessions, cycleStart);
    expect(ex).toEqual(protocolExercise);
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

  it("round-trips conditioningProtocol through the generate-preview -> save re-validation path", () => {
    const result = parseProgramDays([
      {
        label: "Day 3 - 400m Repeats",
        exercises: [
          {
            name: "400m Repeats",
            exerciseId: null,
            targetReps: "6 × 400m",
            notes: "3 min jog recovery between reps, aim for even splits at your target race pace.",
            conditioningProtocol: { structure: "intervals", reps: 6, distanceMeters: 400, description: "3 min jog recovery between reps, aim for even splits at your target race pace." },
          },
        ],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0].exercises[0].conditioningProtocol).toEqual({
      structure: "intervals",
      reps: 6,
      distanceMeters: 400,
      description: "3 min jog recovery between reps, aim for even splits at your target race pace.",
    });
  });

  it("drops an invalid conditioningProtocol (missing description) rather than trusting it", () => {
    const result = parseProgramDays([
      { label: "Workout A", exercises: [{ name: "400m Repeats", conditioningProtocol: { structure: "intervals", reps: 6, distanceMeters: 400, description: "" } }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0].exercises[0].conditioningProtocol).toBeNull();
  });
});

describe("computeCheckpointWeeks", () => {
  it("computes deterministic checkpoint weeks for the standard durations", () => {
    expect(computeCheckpointWeeks(4)).toEqual([1, 4]);
    expect(computeCheckpointWeeks(8)).toEqual([1, 5, 8]);
    expect(computeCheckpointWeeks(12)).toEqual([1, 5, 9, 12]);
  });

  it("handles short/edge durations without duplicating the final week", () => {
    expect(computeCheckpointWeeks(1)).toEqual([1]);
    expect(computeCheckpointWeeks(5)).toEqual([1, 5]);
    expect(computeCheckpointWeeks(0)).toEqual([]);
    expect(computeCheckpointWeeks(-2)).toEqual([]);
  });
});

describe("resolveNextCycleTargets with progressBias", () => {
  const cycleStart = "2026-02-01T00:00:00.000Z";

  it("accelerate bumps sooner — RIR 2 is enough (would hold under normal)", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 12, sets: 3, rir: 2 }])];
    const normal = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg" })], sessions, cycleStart, "normal");
    expect(normal[0].targetWeight).toBe("80 kg");
    const accelerated = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg" })], sessions, cycleStart, "accelerate");
    expect(accelerated[0].targetWeight).toBe("82.5 kg");
  });

  it("hold_back waits longer — RIR 3 isn't enough (would bump under normal)", () => {
    const sessions = [makeSession("2026-02-03", [{ name: "Back Squat", weight: "80", reps: 12, sets: 3, rir: 3 }])];
    const normal = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg" })], sessions, cycleStart, "normal");
    expect(normal[0].targetWeight).toBe("82.5 kg");
    const heldBack = resolveNextCycleTargets([makeExercise({ targetWeight: "80 kg" })], sessions, cycleStart, "hold_back");
    expect(heldBack[0].targetWeight).toBe("80 kg");
  });
});

describe("buildTestCheckpoints", () => {
  it("turns a reps_weight checkpoint into a normal test-type exercise with no invented target", () => {
    const checkpoints = buildTestCheckpoints([
      {
        weekNumber: 1,
        label: "Baseline",
        focusLabel: null,
        exercises: [{ name: "5RM Back Squat", protocol: "5RM", resultType: "reps_weight" }],
      },
    ]);
    expect(checkpoints).toHaveLength(1);
    const [cp] = checkpoints!;
    expect(cp.weekNumber).toBe(1);
    expect(cp.day.type).toBe("test");
    expect(cp.day.exercises[0].name).toBe("5RM Back Squat");
    expect(cp.day.exercises[0].targetReps).toBe("5RM");
    expect(cp.day.exercises[0].targetWeight).toBeNull();
    expect(cp.day.exercises[0].exerciseId).toBeNull();
    expect(cp.day.exercises[0].conditioningProtocol).toBeFalsy();
  });

  it("turns a time_distance checkpoint into a Run-seeding exercise via conditioningProtocol, never a rep target", () => {
    const checkpoints = buildTestCheckpoints([
      {
        weekNumber: 1,
        label: "Baseline",
        focusLabel: null,
        exercises: [{ name: "Standing Broad Jump", protocol: "Max horizontal distance, best of 3", resultType: "time_distance" }],
      },
    ]);
    const [cp] = checkpoints!;
    const [ex] = cp.day.exercises;
    expect(ex.name).toBe("Standing Broad Jump");
    expect(ex.targetReps).toBeNull();
    expect(ex.exerciseId).toBeNull();
    expect(ex.notes).toBe("Max horizontal distance, best of 3");
    expect(ex.conditioningProtocol).toEqual({
      structure: "continuous",
      reps: null,
      distanceMeters: null,
      description: "Max horizontal distance, best of 3",
    });
  });
});

describe("parseTestCheckpoints", () => {
  it("returns undefined for non-array input", () => {
    expect(parseTestCheckpoints(null)).toBeUndefined();
    expect(parseTestCheckpoints("nope")).toBeUndefined();
  });

  it("drops entries with an invalid weekNumber, no label, or no exercises", () => {
    const result = parseTestCheckpoints([
      { weekNumber: 0, day: { label: "Bad week", exercises: [{ name: "Test" }] } },
      { weekNumber: 1, day: { label: "", exercises: [{ name: "Test" }] } },
      { weekNumber: 1, day: { label: "Baseline", exercises: [] } },
      { weekNumber: 1, day: { label: "Baseline", exercises: [{ name: "5RM Back Squat", targetReps: "5RM" }] } },
    ]);
    expect(result).toHaveLength(1);
    expect(result![0].weekNumber).toBe(1);
    expect(result![0].day.exercises[0].name).toBe("5RM Back Squat");
  });

  it("returns undefined when nothing survives validation", () => {
    expect(parseTestCheckpoints([{ weekNumber: -1, day: {} }])).toBeUndefined();
  });
});

describe("applyProgrammeAdjustment", () => {
  it("sets progressBias for accelerate/hold_back without touching totalWeeks or checkpoints", () => {
    const program = makeProgram({ testCheckpoints: [{ weekNumber: 1, day: { id: "cp-1", label: "Baseline", type: "test", exercises: [] } }] });
    const accelerated = applyProgrammeAdjustment(program, "accelerate");
    expect(accelerated.progressBias).toBe("accelerate");
    expect(accelerated.totalWeeks).toBe(program.totalWeeks);
    expect(accelerated.testCheckpoints).toEqual(program.testCheckpoints);

    const heldBack = applyProgrammeAdjustment(program, "hold_back");
    expect(heldBack.progressBias).toBe("hold_back");
  });

  it("expedite_timeline shortens totalWeeks and remaps future checkpoints, leaving past ones untouched", () => {
    const program = makeProgram({
      completedCycles: 4, // currentWeek = 5
      totalWeeks: 12,
      testCheckpoints: [
        { weekNumber: 1, day: { id: "cp-1", label: "Baseline", type: "test", exercises: [] } },
        { weekNumber: 5, day: { id: "cp-2", label: "Mid", type: "test", exercises: [] } },
        { weekNumber: 9, day: { id: "cp-3", label: "Late", type: "test", exercises: [] } },
        { weekNumber: 12, day: { id: "cp-4", label: "Final", type: "test", exercises: [] } },
      ],
    });
    const updated = applyProgrammeAdjustment(program, "expedite_timeline", 8);
    expect(updated.totalWeeks).toBe(8);
    // computeCheckpointWeeks(8) = [1, 5, 8]; only weeks > currentWeek (5) survive as targets: [8]
    const weeks = updated.testCheckpoints!.map((c) => c.weekNumber);
    expect(weeks).toEqual([1, 5, 8]);
    // Past checkpoints (weekNumber <= 5) are the exact original objects.
    expect(updated.testCheckpoints![0]).toEqual(program.testCheckpoints![0]);
    expect(updated.testCheckpoints![1]).toEqual(program.testCheckpoints![1]);
    // The first still-upcoming checkpoint's content is reused, just remapped to week 8.
    expect(updated.testCheckpoints![2].day).toEqual(program.testCheckpoints![2].day);
  });

  it("expedite_timeline is a no-op with no valid proposed week count", () => {
    const program = makeProgram({ totalWeeks: 12 });
    expect(applyProgrammeAdjustment(program, "expedite_timeline")).toEqual(program);
    expect(applyProgrammeAdjustment(program, "expedite_timeline", 0)).toEqual(program);
  });
});

describe("isExerciseRefreshEligible", () => {
  it("is never eligible on week 1 — nothing to refresh on day one", () => {
    expect(isExerciseRefreshEligible(1, 12)).toBe(false);
  });

  it("matches computeCheckpointWeeks exactly, minus week 1", () => {
    // computeCheckpointWeeks(8) = [1, 5, 8]
    expect(isExerciseRefreshEligible(5, 8)).toBe(true);
    expect(isExerciseRefreshEligible(8, 8)).toBe(true);
    expect(isExerciseRefreshEligible(3, 8)).toBe(false);
  });

  it("is false with no totalWeeks", () => {
    expect(isExerciseRefreshEligible(5, null)).toBe(false);
    expect(isExerciseRefreshEligible(5, 0)).toBe(false);
  });
});

describe("resolveProgramStatusTransition", () => {
  it("allows active <-> paused in both directions", () => {
    expect(resolveProgramStatusTransition("active", "paused")).toEqual({ ok: true });
    expect(resolveProgramStatusTransition("paused", "active")).toEqual({ ok: true });
  });

  it("allows cancelling from either active or paused", () => {
    expect(resolveProgramStatusTransition("active", "archived")).toEqual({ ok: true });
    expect(resolveProgramStatusTransition("paused", "archived")).toEqual({ ok: true });
  });

  it("rejects any transition out of archived — it's terminal via this path", () => {
    expect(resolveProgramStatusTransition("archived", "active").ok).toBe(false);
    expect(resolveProgramStatusTransition("archived", "paused").ok).toBe(false);
    expect(resolveProgramStatusTransition("archived", "archived").ok).toBe(false);
  });

  it("rejects a same-status request as a no-op rather than silently succeeding", () => {
    expect(resolveProgramStatusTransition("active", "active").ok).toBe(false);
    expect(resolveProgramStatusTransition("paused", "paused").ok).toBe(false);
  });

  it("returns a human-readable message on rejection", () => {
    const result = resolveProgramStatusTransition("archived", "active");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/archived/);
  });
});

describe("applyExerciseRefresh", () => {
  const library: ExerciseLibraryRecord[] = [
    makeLibraryExercise({ id: "squat", name: "Back Squat", bodyPart: "upper legs" }),
    makeLibraryExercise({ id: "lunge", name: "Dumbbell Lunge", bodyPart: "upper legs" }),
    makeLibraryExercise({ id: "legpress", name: "Leg Press", bodyPart: "upper legs" }),
    makeLibraryExercise({ id: "bench", name: "Bench Press", bodyPart: "chest" }),
    makeLibraryExercise({ id: "flye", name: "Dumbbell Flye", bodyPart: "chest" }),
  ];

  it("swaps a workout day's exercises for different ones in the same muscle group", () => {
    const program = makeProgram({
      days: [
        { id: "day-1", label: "Day A", type: "workout", exercises: [makeExercise({ exerciseId: "squat", name: "Back Squat", muscleTags: ["upper legs"] })] },
      ],
    });

    const updated = applyExerciseRefresh(program, library, [], []);
    const [ex] = updated.days[0].exercises;
    expect(ex.exerciseId).not.toBe("squat");
    expect(["lunge", "legpress"]).toContain(ex.exerciseId);
    expect(ex.muscleTags).toEqual(["upper legs"]);
  });

  it("shares one exclusion set across days so two days never end up with the same exercise", () => {
    // Four candidates for two refreshing days (each excluding its own
    // current pick) guarantees the pool never runs dry, isolating the
    // exclusion-sharing behavior from the separate "pool exhausted, leave
    // unchanged" case covered below.
    const roomyLibrary: ExerciseLibraryRecord[] = [
      ...library,
      makeLibraryExercise({ id: "splitsquat", name: "Split Squat", bodyPart: "upper legs" }),
    ];
    const program = makeProgram({
      days: [
        { id: "day-1", label: "Day A", type: "workout", exercises: [makeExercise({ exerciseId: "squat", name: "Back Squat", muscleTags: ["upper legs"] })] },
        { id: "day-2", label: "Day B", type: "workout", exercises: [makeExercise({ exerciseId: "lunge", name: "Dumbbell Lunge", muscleTags: ["upper legs"] })] },
      ],
    });

    const updated = applyExerciseRefresh(program, roomyLibrary, [], []);
    const ids = updated.days.map((d) => d.exercises[0]?.exerciseId);
    expect(new Set(ids).size).toBe(2); // no repeat across days
    // Days are processed in order, and each day's own current id is added
    // to the shared exclusion set right before it's processed — so day-1
    // (processed first) is only guaranteed to avoid ITS OWN original
    // ("squat"); day-2's original ("lunge") only becomes off-limits once
    // day-2 itself is reached, so day-1 is free to legitimately land on it.
    expect(ids[0]).not.toBe("squat");
    expect(ids[1]).not.toBe("lunge");
  });

  it("re-seeds targets from history for the newly picked exercise, never inventing one", () => {
    const sessions = [makeSession("2026-01-01", [{ name: "Leg Press", weight: "120", reps: 10, sets: 3 }])];
    const program = makeProgram({
      days: [
        {
          id: "day-1",
          label: "Day A",
          type: "workout",
          exercises: [makeExercise({ exerciseId: "squat", name: "Back Squat", muscleTags: ["upper legs"], targetReps: "8-12" })],
        },
      ],
    });

    // Exclude the other upper-legs options so the picker lands on Leg Press deterministically.
    const narrowLibrary = library.filter((e) => e.id !== "squat" && e.id !== "lunge");
    const updated = applyExerciseRefresh(program, narrowLibrary, [], sessions);
    const [ex] = updated.days[0].exercises;
    expect(ex.name).toBe("Leg Press");
    expect(ex.targetWeight).toBe("120 kg"); // anchored to the real logged history
    expect(ex.targetReps).toBe("8-12"); // repScheme (hypertrophy) correctly inferred from the original "8-12"
  });

  it("leaves rest and test days, and a day with no muscleTags, untouched", () => {
    const rest = { id: "rest-1", label: "Rest", type: "rest" as const, exercises: [] };
    const test = {
      id: "test-1",
      label: "Baseline",
      type: "test" as const,
      exercises: [makeExercise({ id: "cp-ex", exerciseId: null, name: "5RM Back Squat", muscleTags: [] })],
    };
    const noTags = { id: "day-3", label: "Day C", type: "workout" as const, exercises: [makeExercise({ muscleTags: [] })] };
    const program = makeProgram({ days: [rest, test, noTags] });

    const updated = applyExerciseRefresh(program, library, [], []);
    expect(updated.days[0]).toEqual(rest);
    expect(updated.days[1]).toEqual(test);
    expect(updated.days[2]).toEqual(noTags);
  });

  it("leaves a day unchanged when nothing else is available in its muscle group/equipment", () => {
    const onlyOption: ExerciseLibraryRecord[] = [makeLibraryExercise({ id: "squat", name: "Back Squat", bodyPart: "upper legs" })];
    const program = makeProgram({
      days: [{ id: "day-1", label: "Day A", type: "workout", exercises: [makeExercise({ exerciseId: "squat", muscleTags: ["upper legs"] })] }],
    });

    const updated = applyExerciseRefresh(program, onlyOption, [], []);
    expect(updated.days[0].exercises[0].exerciseId).toBe("squat"); // nothing else to swap to
  });

  const structuredAiMeta = {
    goal: "Build strength",
    splitStyle: "Full Body",
    rationale: "test",
    daysPerWeek: 3,
    sessionMinutes: 48,
    equipmentSlugs: [],
    gymProfileId: null,
    notes: null,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("with aiMeta.splitMode 'fullBody', refreshes via the structured picker instead of muscleTags", () => {
    const structuredLibrary: ExerciseLibraryRecord[] = [
      makeLibraryExercise({ id: "squat", name: "Back Squat", taxonomy: { forceType: "knee_dominant", primaryRegion: "lower_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "front-squat", name: "Front Squat", taxonomy: { forceType: "knee_dominant", primaryRegion: "lower_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "row", name: "Barbell Row", taxonomy: { forceType: "pull", primaryRegion: "upper_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "pullup2", name: "Pull-Up", taxonomy: { forceType: "pull", primaryRegion: "upper_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "deadlift", name: "Deadlift", taxonomy: { forceType: "hip_dominant", primaryRegion: "lower_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "rdl", name: "Romanian Deadlift", taxonomy: { forceType: "hip_dominant", primaryRegion: "lower_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "pushup", name: "Push-Up", taxonomy: { forceType: "push", primaryRegion: "upper_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "bench2", name: "Bench Press", taxonomy: { forceType: "push", primaryRegion: "upper_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "battle-ropes", name: "Battle Ropes", taxonomy: { forceType: "locomotion", primaryRegion: "cardio", mechanic: "cardio" } }),
      makeLibraryExercise({ id: "row-machine", name: "Rowing Machine", taxonomy: { forceType: "locomotion", primaryRegion: "cardio", mechanic: "cardio" } }),
      makeLibraryExercise({ id: "plank", name: "Plank", taxonomy: { forceType: "core_stability", primaryRegion: "core", mechanic: "core" } }),
      makeLibraryExercise({ id: "deadbug", name: "Dead Bug", taxonomy: { forceType: "core_stability", primaryRegion: "core", mechanic: "core" } }),
    ];
    const currentExerciseIds = ["squat", "row", "deadlift", "pushup", "battle-ropes", "plank"];
    const program = makeProgram({
      aiMeta: { ...structuredAiMeta, splitMode: "fullBody" },
      days: [
        {
          id: "day-1",
          label: "Full Body",
          type: "workout",
          exercises: currentExerciseIds.map((id, i) => makeExercise({ id: `ex-${i}`, exerciseId: id, name: id, muscleTags: [] })),
        },
      ],
    });

    const updated = applyExerciseRefresh(program, structuredLibrary, [], []);
    const newIds = updated.days[0].exercises.map((e) => e.exerciseId);
    expect(newIds).toHaveLength(6);
    for (const id of currentExerciseIds) expect(newIds).not.toContain(id);
    for (const id of newIds) expect(["front-squat", "pullup2", "rdl", "bench2", "row-machine", "deadbug"]).toContain(id);
  });

  it("with aiMeta.splitMode 'upperLower', re-derives the day's half from current exercises and never crosses into the other half", () => {
    const structuredLibrary: ExerciseLibraryRecord[] = [
      makeLibraryExercise({ id: "bench", name: "Bench Press", taxonomy: { forceType: "push", primaryRegion: "upper_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "pushup", name: "Push-Up", taxonomy: { forceType: "push", primaryRegion: "upper_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "row", name: "Barbell Row", taxonomy: { forceType: "pull", primaryRegion: "upper_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "pullup", name: "Pull-Up", taxonomy: { forceType: "pull", primaryRegion: "upper_body", mechanic: "compound" } }),
      // Lower-body alternatives that must never appear in an upper-half refresh.
      makeLibraryExercise({ id: "squat", name: "Back Squat", taxonomy: { forceType: "knee_dominant", primaryRegion: "lower_body", mechanic: "compound" } }),
      makeLibraryExercise({ id: "deadlift", name: "Deadlift", taxonomy: { forceType: "hip_dominant", primaryRegion: "lower_body", mechanic: "compound" } }),
    ];
    const program = makeProgram({
      aiMeta: { ...structuredAiMeta, sessionMinutes: 16, splitMode: "upperLower" },
      days: [
        {
          id: "day-1",
          label: "Upper Body",
          type: "workout",
          exercises: [
            makeExercise({ id: "ex-0", exerciseId: "bench", name: "Bench Press", muscleTags: [] }),
            makeExercise({ id: "ex-1", exerciseId: "row", name: "Barbell Row", muscleTags: [] }),
          ],
        },
      ],
    });

    const updated = applyExerciseRefresh(program, structuredLibrary, [], []);
    const newIds = updated.days[0].exercises.map((e) => e.exerciseId);
    expect(newIds.length).toBeGreaterThan(0);
    for (const id of newIds) expect(["squat", "deadlift"]).not.toContain(id);
  });

  it("leaves a conditioning-protocol day completely untouched in freeform mode", () => {
    const protocolDay = {
      id: "day-1",
      label: "Day 3 - 400m Repeats",
      type: "workout" as const,
      exercises: [
        makeExercise({
          exerciseId: null,
          name: "400m Repeats",
          muscleTags: [],
          targetReps: "6 × 400m",
          conditioningProtocol: { structure: "intervals" as const, reps: 6, distanceMeters: 400, description: "Recover fully between reps." },
        }),
      ],
    };
    const program = makeProgram({ days: [protocolDay] });
    const updated = applyExerciseRefresh(program, library, [], []);
    expect(updated.days[0]).toEqual(protocolDay);
  });

  it("leaves a conditioning-protocol day completely untouched in a structured split, never replacing it with gym exercises", () => {
    const structuredLibrary: ExerciseLibraryRecord[] = [
      makeLibraryExercise({ id: "squat", name: "Back Squat", taxonomy: { forceType: "knee_dominant", primaryRegion: "lower_body", mechanic: "compound" } }),
    ];
    const protocolDay = {
      id: "day-1",
      label: "Day 3 - 400m Repeats",
      type: "workout" as const,
      exercises: [
        makeExercise({
          exerciseId: null,
          name: "400m Repeats",
          muscleTags: [],
          targetReps: "6 × 400m",
          conditioningProtocol: { structure: "intervals" as const, reps: 6, distanceMeters: 400, description: "Recover fully between reps." },
        }),
      ],
    };
    const program = makeProgram({ aiMeta: { ...structuredAiMeta, splitMode: "fullBody" }, days: [protocolDay] });
    const updated = applyExerciseRefresh(program, structuredLibrary, [], []);
    expect(updated.days[0]).toEqual(protocolDay);
  });
});

describe("buildExerciseAlternativeCandidates", () => {
  const library: ExerciseLibraryRecord[] = [
    makeLibraryExercise({ id: "squat", name: "Back Squat", bodyPart: "upper legs" }),
    makeLibraryExercise({ id: "lunge", name: "Dumbbell Lunge", bodyPart: "upper legs" }),
    makeLibraryExercise({ id: "legpress", name: "Leg Press", bodyPart: "upper legs", equipment: "dumbbell" }),
    makeLibraryExercise({ id: "hacksquat", name: "Hack Squat", bodyPart: "upper legs", equipment: "barbell" }),
    makeLibraryExercise({ id: "bench", name: "Bench Press", bodyPart: "chest" }),
  ];

  it("excludes the exercise itself, anything else already in the same day, and non-matching muscle groups", () => {
    const program = makeProgram({
      days: [
        {
          id: "day-1",
          label: "Day A",
          type: "workout",
          exercises: [
            makeExercise({ id: "ex-1", exerciseId: "squat", name: "Back Squat", muscleTags: ["upper legs"] }),
            makeExercise({ id: "ex-2", exerciseId: "lunge", name: "Dumbbell Lunge", muscleTags: ["upper legs"] }),
          ],
        },
      ],
    });

    const candidates = buildExerciseAlternativeCandidates(program, "day-1", "ex-1", library, []);
    const ids = candidates.map((c) => c.id);
    expect(ids).not.toContain("squat"); // the exercise itself
    expect(ids).not.toContain("lunge"); // already used elsewhere in the same day
    expect(ids).not.toContain("bench"); // different muscle group
    expect(ids).toEqual(expect.arrayContaining(["legpress", "hacksquat"]));
  });

  it("respects the programme's equipment constraint", () => {
    const program = makeProgram({
      days: [{ id: "day-1", label: "Day A", type: "workout", exercises: [makeExercise({ id: "ex-1", exerciseId: "squat", muscleTags: ["upper legs"] })] }],
    });

    const candidates = buildExerciseAlternativeCandidates(program, "day-1", "ex-1", library, ["dumbbells"]);
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain("legpress"); // dumbbell — matches
    expect(ids).not.toContain("hacksquat"); // barbell — doesn't match a dumbbells-only selection
  });

  it("returns nothing for a conditioning-protocol exercise or an unknown day/exercise id", () => {
    const protocolExercise = makeExercise({
      id: "ex-1",
      conditioningProtocol: { structure: "continuous", reps: null, distanceMeters: null, description: "Run easy." },
    });
    const program = makeProgram({ days: [{ id: "day-1", label: "Day A", type: "workout", exercises: [protocolExercise] }] });

    expect(buildExerciseAlternativeCandidates(program, "day-1", "ex-1", library, [])).toEqual([]);
    expect(buildExerciseAlternativeCandidates(program, "no-such-day", "ex-1", library, [])).toEqual([]);
    expect(buildExerciseAlternativeCandidates(program, "day-1", "no-such-exercise", library, [])).toEqual([]);
  });
});

describe("replaceProgramDayExercise", () => {
  const newExercise = makeLibraryExercise({ id: "legpress", name: "Leg Press", bodyPart: "upper legs" });

  it("swaps only identity fields, keeping the exercise's id and existing prescription", () => {
    const program = makeProgram({
      days: [
        {
          id: "day-1",
          label: "Day A",
          type: "workout",
          exercises: [makeExercise({ id: "ex-1", exerciseId: "squat", name: "Back Squat", muscleTags: ["upper legs"], targetSets: 4, targetReps: "6-8", targetWeight: "100 kg" })],
        },
      ],
    });

    const updated = replaceProgramDayExercise(program, "day-1", "ex-1", newExercise);
    const [ex] = updated.days[0].exercises;
    expect(ex.id).toBe("ex-1"); // stable id preserved
    expect(ex.exerciseId).toBe("legpress");
    expect(ex.name).toBe("Leg Press");
    expect(ex.muscleTags).toEqual(["upper legs"]);
    // Prescription untouched — a same-slot identity swap, not a re-target.
    expect(ex.targetSets).toBe(4);
    expect(ex.targetReps).toBe("6-8");
    expect(ex.targetWeight).toBe("100 kg");
  });

  it("leaves the programme unchanged for an unknown day/exercise id", () => {
    const program = makeProgram({
      days: [{ id: "day-1", label: "Day A", type: "workout", exercises: [makeExercise({ id: "ex-1" })] }],
    });
    expect(replaceProgramDayExercise(program, "no-such-day", "ex-1", newExercise)).toBe(program);
    expect(replaceProgramDayExercise(program, "day-1", "no-such-exercise", newExercise)).toBe(program);
  });
});

describe("computeAdvancedProgram cycle summaries", () => {
  it("appends a cycleSummaries entry with the real date window on wrap", () => {
    const program = makeProgram({ currentDayIndex: 1, cycleStartedAt: "2026-02-01T00:00:00.000Z", completedCycles: 0 });
    const updated = computeAdvancedProgram(program, []);
    expect(updated.cycleSummaries).toHaveLength(1);
    expect(updated.cycleSummaries![0].cycleIndex).toBe(0);
    expect(updated.cycleSummaries![0].startedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(updated.cycleSummaries![0].endedAt).toBe(updated.cycleStartedAt);
  });
});
