import { describe, expect, it } from "vitest";

import type { PrescribedExercise, TrainingProgramRecord, WorkoutSessionRecord } from "@/lib/db";
import { buildProgrammeCheckInData } from "@/lib/programme-checkin";

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
    days: [{ id: "day-1", label: "Day A", type: "workout", exercises: [makeExercise()] }],
    currentDayIndex: 0,
    createdByStaffId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "ai",
    totalWeeks: 8,
    completedCycles: 1,
    cycleStartedAt: "2026-02-08T00:00:00.000Z",
    cycleSummaries: [{ cycleIndex: 0, startedAt: "2026-02-01T00:00:00.000Z", endedAt: "2026-02-08T00:00:00.000Z" }],
    aiMeta: null,
    ...overrides,
  };
}

function makeSession(date: string, exercises: WorkoutSessionRecord["exercises"]): WorkoutSessionRecord {
  return {
    id: `sess-${date}`,
    userId: "user-1",
    date,
    title: "Workout",
    durationMins: 45,
    notes: null,
    exercises,
    runs: [],
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

describe("buildProgrammeCheckInData exerciseTrends", () => {
  it("excludes a conditioning-protocol exercise entirely rather than reporting it as 'not logged'", () => {
    const program = makeProgram({
      days: [
        {
          id: "day-1",
          label: "Day 3 - 400m Repeats",
          type: "workout",
          exercises: [
            makeExercise({
              exerciseId: null,
              name: "400m Repeats",
              muscleTags: [],
              conditioningProtocol: { structure: "intervals", reps: 6, distanceMeters: 400, description: "Recover fully between reps." },
            }),
            makeExercise({ id: "ex-2", name: "Bench Press" }),
          ],
        },
      ],
    });
    // Only the strength exercise was logged this cycle — the member's
    // actual completed run lives in a separate session's `runs` array,
    // which this function never reads at all (a pre-existing, separate gap
    // that this test isn't about).
    const sessions = [
      makeSession("2026-02-03", [{ exerciseId: "lib-1", name: "Bench Press", weight: "80", reps: 10, sets: 3, rir: 3, notes: null }]),
    ];

    const data = buildProgrammeCheckInData(program, sessions, 0);

    expect(data.exerciseTrends).toHaveLength(1);
    expect(data.exerciseTrends[0].name).toBe("Bench Press");
    expect(data.exerciseTrends.some((t) => t.name === "400m Repeats")).toBe(false);
  });

  it("still reports normal strength exercises as 'not logged' when they genuinely weren't", () => {
    const program = makeProgram({
      days: [{ id: "day-1", label: "Day A", type: "workout", exercises: [makeExercise({ name: "Back Squat" })] }],
    });
    const data = buildProgrammeCheckInData(program, [], 0);
    expect(data.exerciseTrends).toEqual([{ name: "Back Squat", rir: null, hitTarget: null }]);
  });
});
