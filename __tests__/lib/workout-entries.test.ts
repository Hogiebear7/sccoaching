import { describe, expect, it } from "vitest";

import { formatExerciseLoad, parseExerciseEntries } from "@/lib/workout-entries";
import { computePersonalBests, weeklyWorkoutStats } from "@/lib/workouts";
import type { WorkoutSessionRecord } from "@/lib/db";

describe("parseExerciseEntries", () => {
  it("parses per-set details and RPE, dropping empty sets and nameless rows", () => {
    const parsed = parseExerciseEntries([
      {
        name: " Bench Press ",
        weight: "60",
        reps: 8,
        sets: 3,
        rpe: 8.25,
        setDetails: [
          { weight: "60", reps: 8 },
          { weight: "65", reps: 6 },
          { weight: null, reps: null }, // empty — dropped
        ],
      },
      { name: "", weight: "100" }, // nameless — dropped
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Bench Press");
    expect(parsed[0].rpe).toBe(8.5); // rounded to nearest 0.5
    expect(parsed[0].setDetails).toEqual([
      { weight: "60", reps: 8 },
      { weight: "65", reps: 6 },
    ]);
  });

  it("rejects out-of-range RPE and keeps setDetails null when absent", () => {
    const parsed = parseExerciseEntries([{ name: "Row", rpe: 14 }, { name: "Curl" }]);
    expect(parsed[0].rpe).toBeNull();
    expect(parsed[0].setDetails).toBeNull();
    expect(parsed[1].setDetails).toBeNull();
  });
});

describe("formatExerciseLoad", () => {
  it("shows per-set breakdown when details exist, shared form otherwise", () => {
    expect(
      formatExerciseLoad({
        exerciseId: null,
        name: "Bench",
        weight: "60",
        reps: 8,
        sets: 3,
        setDetails: [
          { weight: "60", reps: 8 },
          { weight: "65", reps: 6 },
        ],
        notes: null,
      })
    ).toBe("60×8, 65×6");

    expect(
      formatExerciseLoad({
        exerciseId: null,
        name: "Bench",
        weight: "60 kg",
        reps: 8,
        sets: 3,
        rpe: 8,
        setDetails: null,
        notes: null,
      })
    ).toBe("3×8 @ 60 kg RPE 8");
  });
});

describe("per-set aware stats", () => {
  function session(exercises: WorkoutSessionRecord["exercises"]): WorkoutSessionRecord {
    return {
      id: "s1",
      userId: "u1",
      date: "2026-07-15",
      title: "T",
      durationMins: null,
      notes: null,
      exercises,
      runs: [],
      createdAt: "x",
      updatedAt: "x",
    };
  }

  it("weekly volume sums each set individually when details exist", () => {
    const stats = weeklyWorkoutStats(
      [
        session([
          {
            exerciseId: null,
            name: "Squat",
            weight: "60",
            reps: 5,
            sets: 3,
            setDetails: [
              { weight: "60", reps: 5 }, // 300
              { weight: "70", reps: 3 }, // 210
              { weight: "80", reps: 1 }, // 80
            ],
            notes: null,
          },
        ]),
      ],
      "2026-07-15"
    );
    expect(stats.totalKg).toBe(590);
  });

  it("personal bests read the heaviest individual set", () => {
    const bests = computePersonalBests([
      session([
        {
          exerciseId: null,
          name: "Squat",
          weight: "60",
          reps: 5,
          sets: 3,
          setDetails: [
            { weight: "60", reps: 5 },
            { weight: "85", reps: 2 },
          ],
          notes: null,
        },
      ]),
    ]);
    expect(bests[0].heaviestWeight).toMatchObject({ value: 85, reps: 2 });
    expect(bests[0].highestReps).toMatchObject({ reps: 5 });
  });
});
