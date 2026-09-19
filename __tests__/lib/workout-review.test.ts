import { describe, expect, it } from "vitest";

import { formatWorkoutReviewContext, type WorkoutReviewData } from "@/lib/workout-review";
import type { WorkoutSessionRecord } from "@/lib/db";

function baseSession(overrides: Partial<WorkoutSessionRecord> = {}): WorkoutSessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    date: "2026-06-19",
    title: "Lower Body Strength",
    durationMins: 60,
    notes: null,
    exercises: [],
    runs: [],
    createdAt: "2026-06-19T12:00:00.000Z",
    updatedAt: "2026-06-19T12:00:00.000Z",
    ...overrides,
  };
}

function baseData(session: WorkoutSessionRecord): WorkoutReviewData {
  return {
    session,
    comparison: {
      thisVolume: 1000,
      thisDurationMins: session.durationMins,
      thisRpe: null,
      recentAvgVolume: null,
      recentAvgRpe: null,
      recentAvgDurationMins: null,
      comparedSessionCount: 0,
    },
    recovery: null,
    cyclePhase: null,
    pregnancy: null,
    nutrition: null,
    hydration: null,
  };
}

describe("formatWorkoutReviewContext — time of day", () => {
  it("says the time of day is not known when startedAtHour is absent", () => {
    const text = formatWorkoutReviewContext(baseData(baseSession()));

    expect(text).toContain("Time of day this workout happened is not known");
    expect(text).not.toContain("was trained in the");
  });

  it("describes an early-morning session", () => {
    const text = formatWorkoutReviewContext(baseData(baseSession({ startedAtHour: 6 })));

    expect(text).toContain("This workout was trained in the early morning (local time).");
  });

  it("describes an evening session", () => {
    const text = formatWorkoutReviewContext(baseData(baseSession({ startedAtHour: 19 })));

    expect(text).toContain("This workout was trained in the evening (local time).");
  });

  it("describes a late-night session", () => {
    const text = formatWorkoutReviewContext(baseData(baseSession({ startedAtHour: 23 })));

    expect(text).toContain("This workout was trained in the late night (local time).");
  });
});
