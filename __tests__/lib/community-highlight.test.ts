import { describe, expect, it } from "vitest";

import type { WorkoutSessionRecord } from "@/lib/db";
import { findRecentWin, sessionPbExerciseName, type FollowedMemberActivity } from "@/lib/community-highlight";
import { computePersonalBests } from "@/lib/workouts";

function session(
  id: string,
  date: string,
  exercises: Partial<WorkoutSessionRecord["exercises"][number]>[],
  overrides: Partial<WorkoutSessionRecord> = {}
): WorkoutSessionRecord {
  return {
    id,
    userId: "user-1",
    date,
    title: "Session",
    durationMins: 60,
    notes: null,
    exercises: exercises.map((e) => ({
      exerciseId: null,
      name: "Back Squat",
      weight: null,
      reps: null,
      sets: null,
      notes: null,
      ...e,
    })),
    runs: [],
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
    ...overrides,
  };
}

const TODAY = "2026-09-08";

describe("findRecentWin", () => {
  it("finds a session where the logged weight matches that member's all-time best, dated to this session", () => {
    const sessions = [
      session("s1", "2026-08-01", [{ weight: "80", reps: 5, sets: 3 }]),
      session("s2", "2026-09-06", [{ weight: "100", reps: 5, sets: 3 }]), // new best, within the window
    ];
    const members: FollowedMemberActivity[] = [{ userId: "user-1", fullName: "Alex Athlete", allSessions: sessions }];

    const win = findRecentWin(members, TODAY);
    expect(win).toEqual({ userId: "user-1", authorName: "Alex Athlete", exerciseName: "Back Squat", sessionId: "s2", date: "2026-09-06" });
  });

  it("ignores a session that merely repeats a past best rather than setting a new one", () => {
    const sessions = [
      session("s1", "2026-08-01", [{ weight: "100", reps: 5, sets: 3 }]),
      session("s2", "2026-09-06", [{ weight: "100", reps: 5, sets: 3 }]), // ties, doesn't beat — best stays dated to s1
    ];
    const members: FollowedMemberActivity[] = [{ userId: "user-1", fullName: "Alex Athlete", allSessions: sessions }];

    expect(findRecentWin(members, TODAY)).toBeNull();
  });

  it("ignores wins outside the trailing window", () => {
    const sessions = [session("s1", "2026-08-01", [{ weight: "100", reps: 5, sets: 3 }])]; // >7 days before TODAY
    const members: FollowedMemberActivity[] = [{ userId: "user-1", fullName: "Alex Athlete", allSessions: sessions }];

    expect(findRecentWin(members, TODAY)).toBeNull();
  });

  it("ignores a private session even if it set a new best", () => {
    const sessions = [session("s1", "2026-09-06", [{ weight: "100", reps: 5, sets: 3 }], { isPrivate: true })];
    const members: FollowedMemberActivity[] = [{ userId: "user-1", fullName: "Alex Athlete", allSessions: sessions }];

    expect(findRecentWin(members, TODAY)).toBeNull();
  });

  it("picks the most recent win across multiple followed members", () => {
    const older = [session("s1", "2026-09-02", [{ weight: "100", reps: 5, sets: 3 }])];
    const newer = [session("s2", "2026-09-07", [{ weight: "60", reps: 5, sets: 3, name: "Bench Press" }])];
    const members: FollowedMemberActivity[] = [
      { userId: "user-1", fullName: "Older Win", allSessions: older },
      { userId: "user-2", fullName: "Newer Win", allSessions: newer },
    ];

    expect(findRecentWin(members, TODAY)?.authorName).toBe("Newer Win");
  });
});

describe("sessionPbExerciseName", () => {
  it("returns the exercise name when this session set the all-time best", () => {
    const sessions = [session("s1", "2026-09-01", [{ weight: "80", reps: 5, sets: 3 }])];
    const bests = computePersonalBests(sessions);
    expect(sessionPbExerciseName(sessions[0], bests)).toBe("Back Squat");
  });

  it("returns null for a session that isn't where the record was set", () => {
    const sessions = [
      session("s1", "2026-09-01", [{ weight: "100", reps: 5, sets: 3 }]),
      session("s2", "2026-09-05", [{ weight: "80", reps: 5, sets: 3 }]),
    ];
    const bests = computePersonalBests(sessions);
    expect(sessionPbExerciseName(sessions[1], bests)).toBeNull();
  });
});
