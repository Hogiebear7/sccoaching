import { describe, expect, it } from "vitest";

import {
  buildMemberStatsData,
  formatDistanceKm,
  formatWeightKg,
  rangeStartDate,
  sumStatsInRange,
  workoutDistanceKm,
  workoutVolumeKg,
  type MemberStatsData,
} from "@/lib/member-stats";
import type { BookingRecord, WorkoutSessionRecord } from "@/lib/db";

function session(overrides: Partial<WorkoutSessionRecord> = {}): WorkoutSessionRecord {
  return {
    id: "s1",
    userId: "u1",
    date: "2026-07-01",
    title: "Session",
    durationMins: null,
    notes: null,
    exercises: [],
    runs: [],
    createdAt: "x",
    updatedAt: "x",
    ...overrides,
  };
}

describe("workoutVolumeKg", () => {
  it("multiplies shared weight × reps × sets", () => {
    const s = session({
      exercises: [{ exerciseId: null, name: "Squat", weight: "60", reps: 5, sets: 5, notes: null }],
    });
    expect(workoutVolumeKg(s)).toBe(1500); // 60 * 5 * 5
  });

  it("prefers per-set details when present", () => {
    const s = session({
      exercises: [
        {
          exerciseId: null,
          name: "Bench",
          weight: "50",
          reps: 5,
          sets: 3,
          setDetails: [
            { weight: "40", reps: 5 },
            { weight: "50", reps: 5 },
            { weight: "60", reps: 3 },
          ],
          notes: null,
        },
      ],
    });
    // 40*5 + 50*5 + 60*3 = 200 + 250 + 180 = 630 (shared 50*5*3=750 ignored)
    expect(workoutVolumeKg(s)).toBe(630);
  });

  it("treats non-numeric / blank / null weight as 0", () => {
    const s = session({
      exercises: [
        { exerciseId: null, name: "Push-up", weight: "bodyweight", reps: 20, sets: 3, notes: null },
        { exerciseId: null, name: "Plank", weight: "", reps: 1, sets: 3, notes: null },
        { exerciseId: null, name: "Dip", weight: null, reps: 10, sets: 3, notes: null },
      ],
    });
    expect(workoutVolumeKg(s)).toBe(0);
  });

  it("handles missing reps/sets as 0", () => {
    const s = session({
      exercises: [{ exerciseId: null, name: "X", weight: "100", reps: null, sets: null, notes: null }],
    });
    expect(workoutVolumeKg(s)).toBe(0);
  });
});

describe("workoutDistanceKm", () => {
  it("sums run distances, treating null as 0", () => {
    const s = session({
      runs: [
        { distance: 5, distanceUnit: "km", durationSecs: null, reps: null, sets: null, notes: null },
        { distance: 2.5, distanceUnit: "km", durationSecs: null, reps: null, sets: null, notes: null },
        { distance: null, distanceUnit: "km", durationSecs: null, reps: null, sets: null, notes: null },
      ],
    });
    expect(workoutDistanceKm(s)).toBe(7.5);
  });
});

describe("buildMemberStatsData", () => {
  const booking = (overrides: Partial<BookingRecord>): BookingRecord => ({
    id: "b1",
    classId: "c1",
    userId: "u1",
    attendedAt: null,
    createdAt: "x",
    ...overrides,
  });

  it("counts only attended bookings and buckets by the class date", () => {
    const data = buildMemberStatsData(
      [],
      [
        booking({ id: "b1", classId: "c1", attendedAt: "2026-07-02T10:00:00.000Z" }),
        booking({ id: "b2", classId: "c2", attendedAt: null }), // not attended
      ],
      { c1: "2026-06-30" }
    );
    expect(data.completedClassDates).toEqual(["2026-06-30"]);
  });

  it("falls back to the attendedAt date when the class is missing", () => {
    const data = buildMemberStatsData(
      [],
      [booking({ id: "b1", classId: "gone", attendedAt: "2026-07-02T10:00:00.000Z" })],
      {}
    );
    expect(data.completedClassDates).toEqual(["2026-07-02"]);
  });
});

describe("rangeStartDate", () => {
  const TODAY = new Date("2026-07-15T12:00:00.000Z");

  it("returns null for all time", () => {
    expect(rangeStartDate("all", TODAY)).toBeNull();
  });

  it("subtracts the right window for presets", () => {
    expect(rangeStartDate("week", TODAY)).toBe("2026-07-08");
    expect(rangeStartDate("month", TODAY)).toBe("2026-06-15");
    expect(rangeStartDate("3months", TODAY)).toBe("2026-04-15");
    expect(rangeStartDate("6months", TODAY)).toBe("2026-01-15");
    expect(rangeStartDate("year", TODAY)).toBe("2025-07-15");
  });

  it("uses customFrom for a custom range", () => {
    expect(rangeStartDate("custom", TODAY, "2026-03-01")).toBe("2026-03-01");
    expect(rangeStartDate("custom", TODAY, "")).toBeNull();
  });
});

describe("sumStatsInRange", () => {
  const data: MemberStatsData = {
    workouts: [
      { date: "2026-05-01", weightKg: 1000, distanceKm: 5 },
      { date: "2026-07-10", weightKg: 2000, distanceKm: 10 },
      { date: "2026-07-14", weightKg: 500, distanceKm: 0 },
    ],
    completedClassDates: ["2026-05-01", "2026-07-10", "2026-07-14"],
  };

  it("sums everything for all time (null bounds)", () => {
    expect(sumStatsInRange(data, null, null)).toEqual({
      classesCompleted: 3,
      totalWeightKg: 3500,
      totalDistanceKm: 15,
    });
  });

  it("applies an inclusive start bound", () => {
    expect(sumStatsInRange(data, "2026-07-01", null)).toEqual({
      classesCompleted: 2,
      totalWeightKg: 2500,
      totalDistanceKm: 10,
    });
  });

  it("applies an inclusive custom window", () => {
    expect(sumStatsInRange(data, "2026-07-10", "2026-07-10")).toEqual({
      classesCompleted: 1,
      totalWeightKg: 2000,
      totalDistanceKm: 10,
    });
  });

  it("returns zeros when nothing is in range", () => {
    expect(sumStatsInRange(data, "2027-01-01", null)).toEqual({
      classesCompleted: 0,
      totalWeightKg: 0,
      totalDistanceKm: 0,
    });
  });
});

describe("formatting", () => {
  it("weight is whole kg, thousands-separated", () => {
    expect(formatWeightKg(12345.7)).toBe("12,346 kg");
    expect(formatWeightKg(0)).toBe("0 kg");
  });

  it("distance is one decimal km", () => {
    expect(formatDistanceKm(7.25)).toBe("7.3 km");
    expect(formatDistanceKm(0)).toBe("0.0 km");
  });
});
