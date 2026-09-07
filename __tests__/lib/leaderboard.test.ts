import { describe, expect, it } from "vitest";

import type { CommunityPrivacyRecord, WorkoutSessionRecord } from "@/lib/db";
import { computeLeaderboard, type LeaderboardMemberInput } from "@/lib/leaderboard";

function session(
  date: string,
  exercises: Partial<WorkoutSessionRecord["exercises"][number]>[]
): WorkoutSessionRecord {
  return {
    id: `s-${date}-${Math.random()}`,
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
  };
}

function member(overrides: Partial<LeaderboardMemberInput> = {}): LeaderboardMemberInput {
  return {
    userId: "user-1",
    fullName: "Alex Rider",
    sessions: [],
    currentWeightKg: 80,
    privacy: undefined,
    ...overrides,
  };
}

function privacy(overrides: Partial<CommunityPrivacyRecord> = {}): CommunityPrivacyRecord {
  return {
    userId: "user-1",
    leaderboardVisible: true,
    showRealName: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeLeaderboard", () => {
  it("ranks total volume, highest first", () => {
    const entries = computeLeaderboard("volume", [
      member({ userId: "a", fullName: "A", sessions: [session("2026-01-01", [{ weight: "100", reps: 5, sets: 3 }])] }), // 1500
      member({ userId: "b", fullName: "B", sessions: [session("2026-01-01", [{ weight: "100", reps: 5, sets: 5 }])] }), // 2500
    ]);
    expect(entries.map((e) => e.userId)).toEqual(["b", "a"]);
    expect(entries[0].value).toBe(2500);
    expect(entries[0].bodyweightPct).toBeNull();
  });

  it("finds the heaviest Squat/Bench/Deadlift by keyword and computes % of bodyweight", () => {
    const entries = computeLeaderboard("squat", [
      member({
        currentWeightKg: 100,
        sessions: [session("2026-01-01", [{ name: "Barbell Back Squat", weight: "150", reps: 5, sets: 1 }])],
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe(150);
    expect(entries[0].bodyweightPct).toBe(150); // 150/100 * 100
  });

  it("excludes a member who never logged the requested lift", () => {
    const entries = computeLeaderboard("deadlift", [
      member({ sessions: [session("2026-01-01", [{ name: "Bench Press", weight: "80", reps: 5, sets: 3 }])] }),
    ]);
    expect(entries).toEqual([]);
  });

  it("excludes a member whose CommunityPrivacyRecord opts out of the leaderboard", () => {
    const entries = computeLeaderboard("volume", [
      member({ sessions: [session("2026-01-01", [{ weight: "100", reps: 5, sets: 3 }])], privacy: privacy({ leaderboardVisible: false }) }),
    ]);
    expect(entries).toEqual([]);
  });

  it("shows first name + last initial when a member opts out of showing their real name", () => {
    const entries = computeLeaderboard("volume", [
      member({
        fullName: "Jamie Fox",
        sessions: [session("2026-01-01", [{ weight: "100", reps: 5, sets: 3 }])],
        privacy: privacy({ showRealName: false }),
      }),
    ]);
    expect(entries[0].displayName).toBe("Jamie F.");
  });

  it("returns null bodyweightPct when the member has no current weight on file", () => {
    const entries = computeLeaderboard("bench", [
      member({ currentWeightKg: null, sessions: [session("2026-01-01", [{ name: "Bench Press", weight: "80", reps: 5, sets: 3 }])] }),
    ]);
    expect(entries[0].bodyweightPct).toBeNull();
  });
});
