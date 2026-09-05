import { describe, expect, it } from "vitest";

import type { PrescribedExercise, TrainingProgramRecord, WorkoutSessionRecord } from "@/lib/db";
import type { ExerciseLibraryRecord } from "@/lib/exercise-library/types";
import {
  applyExerciseRefresh,
  applyProgrammeAdjustment,
  applyTierModifier,
  buildTestCheckpoints,
  computeAdvancedProgram,
  computeCheckpointWeeks,
  isExerciseRefreshEligible,
  parseProgramDays,
  parseTestCheckpoints,
  resolveInitialProgrammeTargets,
  resolveNextCycleTargets,
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
  it("turns AI-authored checkpoint proposals into test-type ProgramDayRecords with no invented target", () => {
    const checkpoints = buildTestCheckpoints([
      { weekNumber: 1, label: "Baseline", focusLabel: null, exercises: [{ name: "5RM Back Squat", protocol: "5RM" }] },
    ]);
    expect(checkpoints).toHaveLength(1);
    const [cp] = checkpoints!;
    expect(cp.weekNumber).toBe(1);
    expect(cp.day.type).toBe("test");
    expect(cp.day.exercises[0].name).toBe("5RM Back Squat");
    expect(cp.day.exercises[0].targetReps).toBe("5RM");
    expect(cp.day.exercises[0].targetWeight).toBeNull();
    expect(cp.day.exercises[0].exerciseId).toBeNull();
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
    expect(ids).not.toContain("squat");
    expect(ids).not.toContain("lunge");
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
