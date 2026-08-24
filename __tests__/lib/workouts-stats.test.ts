import { describe, expect, it } from "vitest";

import type { WorkoutSessionRecord } from "@/lib/db";
import { computePersonalBests, weeklyWorkoutStats } from "@/lib/workouts";

function session(
  date: string,
  exercises: Partial<WorkoutSessionRecord["exercises"][number]>[]
): WorkoutSessionRecord {
  return {
    id: `s-${date}`,
    userId: "user-1",
    date,
    title: "Session",
    durationMins: 60,
    notes: null,
    exercises: exercises.map((e) => ({
      exerciseId: null,
      name: "Bench Press",
      weight: null,
      reps: null,
      sets: null,
      notes: null,
      ...e,
    })),
    runs: [],
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
  };
}

// 2026-07-08 is a Wednesday → week starts Monday 2026-07-06.
const TODAY = "2026-07-08";

describe("weeklyWorkoutStats", () => {
  it("counts sessions since Monday and sums sets × reps × kg", () => {
    const stats = weeklyWorkoutStats(
      [
        session("2026-07-06", [{ weight: "100", sets: 3, reps: 5 }]), // 1500
        session("2026-07-07", [{ weight: "60", sets: 4, reps: 10 }]), // 2400
        session("2026-07-05", [{ weight: "200", sets: 5, reps: 5 }]), // last week
      ],
      TODAY
    );
    expect(stats).toEqual({ count: 2, totalKg: 3900 });
  });

  it("ignores non-numeric weights and treats missing sets/reps as 1", () => {
    const stats = weeklyWorkoutStats(
      [session(TODAY, [{ weight: "band" }, { weight: "80", sets: null, reps: null }])],
      TODAY
    );
    expect(stats).toEqual({ count: 1, totalKg: 80 });
  });

  it("sums a per-side set's repsRight + repsLeft, not the null reps field", () => {
    const stats = weeklyWorkoutStats(
      [
        session(TODAY, [
          { weight: "20", reps: null, setDetails: [{ weight: "20", reps: null, repsRight: 10, repsLeft: 10 }] },
        ]),
      ],
      TODAY
    );
    // 20kg × (10 + 10) reps = 400, not 20kg × 1 (the old "?? 1" fallback).
    expect(stats).toEqual({ count: 1, totalKg: 400 });
  });
});

describe("computePersonalBests — reps at heaviest set", () => {
  it("carries the reps performed at the top weight", () => {
    const bests = computePersonalBests([
      session("2026-07-01", [{ weight: "90", reps: 8 }]),
      session("2026-07-06", [{ weight: "100", reps: 5 }]),
    ]);
    expect(bests[0].heaviestWeight).toMatchObject({ value: 100, reps: 5 });
    expect(bests[0].highestReps).toMatchObject({ reps: 8 });
  });

  it("counts a per-side set's combined repsRight + repsLeft toward the reps PB", () => {
    const bests = computePersonalBests([
      session("2026-07-01", [
        { name: "Forward Lunge", weight: "20", reps: null, setDetails: [{ weight: "20", reps: null, repsRight: 10, repsLeft: 10 }] },
      ]),
    ]);
    expect(bests[0].heaviestWeight).toMatchObject({ value: 20 });
    // 10 + 10, not excluded entirely for having a null top-level reps.
    expect(bests[0].highestReps).toMatchObject({ reps: 20 });
  });
});
