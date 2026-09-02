import { describe, expect, it } from "vitest";

import { exertionForDate } from "@/lib/nutrition-target-data";
import type { RecoveryLogRecord, WorkoutSessionRecord } from "@/lib/db";
import type { WeeklyTrainingSession } from "@/lib/profile-schema";

const DATE = "2026-08-19"; // a Wednesday

function makeRecoveryLog(overrides: Partial<RecoveryLogRecord> = {}): RecoveryLogRecord {
  return {
    id: "rec-1",
    userId: "user-1",
    date: DATE,
    sleepHours: 7,
    sleepQuality: 6,
    soreness: 3,
    fatigue: 3,
    trainingDurationMins: null,
    rpe: null,
    goal: null,
    notes: null,
    readinessScore: 70,
    createdAt: `${DATE}T08:00:00.000Z`,
    updatedAt: `${DATE}T08:00:00.000Z`,
    ...overrides,
  };
}

function makeWorkoutSession(overrides: Partial<WorkoutSessionRecord> = {}): WorkoutSessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    date: DATE,
    title: "Session",
    durationMins: null,
    notes: null,
    exercises: [],
    runs: [],
    sessionRpe: null,
    createdAt: `${DATE}T10:00:00.000Z`,
    updatedAt: `${DATE}T10:00:00.000Z`,
    ...overrides,
  };
}

// dayOfWeek 3 matches DATE (2026-08-19, a Wednesday). sport+heavy is the
// only combo exertionFromWeeklySessions maps to "match" (lib/nutrition-target.ts) —
// used here as a plan value that's unambiguously distinct from every load
// band a workout/recovery load in these tests produces.
function makeWeeklySession(overrides: Partial<WeeklyTrainingSession> = {}): WeeklyTrainingSession {
  return {
    id: "wt-1",
    dayOfWeek: 3,
    label: "Match day",
    activityType: "sport",
    timeOfDay: null,
    intensity: "heavy",
    estimatedDurationMins: null,
    notes: null,
    recurring: true,
    weekOf: null,
    sourceBookingId: null,
    ...overrides,
  };
}

describe("exertionForDate", () => {
  it("falls back to the weekly plan when there's no Recovery log or logged workout", () => {
    const sessions = [makeWeeklySession()]; // sport+heavy -> "match"
    expect(exertionForDate(DATE, [], sessions, [])).toBe("match");
  });

  it("prefers a same-date logged workout over the weekly plan", () => {
    const sessions = [makeWeeklySession({ activityType: "gym", intensity: "light" })]; // -> "low" alone
    const workoutSessions = [makeWorkoutSession({ durationMins: 90, sessionRpe: 8 })]; // 720 load -> "match"
    expect(exertionForDate(DATE, [], sessions, workoutSessions)).toBe("match");
  });

  it("still prefers the Recovery log over a same-date logged workout", () => {
    const recoveryLogs = [makeRecoveryLog({ trainingDurationMins: 20, rpe: 2 })]; // 40 load -> "medium"
    const workoutSessions = [makeWorkoutSession({ durationMins: 90, sessionRpe: 8 })]; // 720 load -> "match"
    expect(exertionForDate(DATE, recoveryLogs, [], workoutSessions)).toBe("medium");
  });

  it("sums multiple same-date logged workouts rather than taking one", () => {
    const workoutSessions = [
      makeWorkoutSession({ id: "s1", durationMins: 30, sessionRpe: 4 }), // 120
      makeWorkoutSession({ id: "s2", durationMins: 30, sessionRpe: 4 }), // 120 -> 240 total, "medium"
    ];
    expect(exertionForDate(DATE, [], [], workoutSessions)).toBe("medium");
  });

  it("ignores a logged workout missing duration or RPE, falling through to the weekly plan", () => {
    const sessions = [makeWeeklySession()]; // sport+heavy -> "match"
    const workoutSessions = [makeWorkoutSession({ durationMins: 90, sessionRpe: null })];
    expect(exertionForDate(DATE, [], sessions, workoutSessions)).toBe("match");
  });

  it("ignores a logged workout on a different date", () => {
    const sessions = [makeWeeklySession()]; // sport+heavy -> "match"
    const workoutSessions = [makeWorkoutSession({ date: "2026-08-20", durationMins: 90, sessionRpe: 9 })];
    expect(exertionForDate(DATE, [], sessions, workoutSessions)).toBe("match");
  });
});
