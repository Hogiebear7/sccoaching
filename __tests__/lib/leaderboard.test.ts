import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommunityPrivacyRecord, WorkoutSessionRecord } from "@/lib/db";
import { computeLeaderboard, filterSessionsByRange, type LeaderboardMemberInput } from "@/lib/leaderboard";

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
    discoverable: true,
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

describe("filterSessionsByRange", () => {
  // Anchored "now" so week/month/year trailing windows are deterministic —
  // these are relative-to-today windows, not calendar-aligned periods (see
  // lib/leaderboard.ts's comment on why), so the test has to fix "today".
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const sessions = [
    session("2026-06-15", []), // today
    session("2026-06-10", []), // 5 days ago — inside week
    session("2026-06-01", []), // 14 days ago — outside week, inside month
    session("2026-01-01", []), // ~165 days ago — outside month, inside year
    session("2024-01-01", []), // outside year
  ];

  it("'all' returns every session untouched", () => {
    expect(filterSessionsByRange(sessions, "all")).toHaveLength(5);
  });

  it("'week' keeps only the trailing 7 days", () => {
    const result = filterSessionsByRange(sessions, "week");
    expect(result.map((s) => s.date)).toEqual(["2026-06-15", "2026-06-10"]);
  });

  it("'month' keeps only the trailing 30 days", () => {
    const result = filterSessionsByRange(sessions, "month");
    expect(result.map((s) => s.date)).toEqual(["2026-06-15", "2026-06-10", "2026-06-01"]);
  });

  it("'year' keeps only the trailing 365 days", () => {
    const result = filterSessionsByRange(sessions, "year");
    expect(result.map((s) => s.date)).toEqual(["2026-06-15", "2026-06-10", "2026-06-01", "2026-01-01"]);
  });

  it("a member who joined recently gets the same window length as a long-time member", () => {
    // The actual fairness property: two members with sessions only inside
    // the trailing window rank on equal footing, regardless of how long
    // ago either of them joined — nothing outside the window is compared.
    const longTimeMember = [session("2024-01-01", [{ weight: "100", reps: 5, sets: 3 }]), session("2026-06-10", [{ weight: "100", reps: 5, sets: 3 }])];
    const newMember = [session("2026-06-10", [{ weight: "100", reps: 5, sets: 3 }])];
    const longTimeFiltered = filterSessionsByRange(longTimeMember, "week");
    const newFiltered = filterSessionsByRange(newMember, "week");
    expect(longTimeFiltered).toHaveLength(1);
    expect(newFiltered).toHaveLength(1);
  });

  it("'custom' keeps sessions within an inclusive [start, end] range", () => {
    const result = filterSessionsByRange(sessions, "custom", "2026-01-01", "2026-06-10");
    expect(result.map((s) => s.date)).toEqual(["2026-06-10", "2026-06-01", "2026-01-01"]);
  });

  it("'custom' with only a start bound leaves the end open", () => {
    const result = filterSessionsByRange(sessions, "custom", "2026-06-01", null);
    expect(result.map((s) => s.date)).toEqual(["2026-06-15", "2026-06-10", "2026-06-01"]);
  });

  it("'custom' with no bounds at all returns every session untouched", () => {
    expect(filterSessionsByRange(sessions, "custom", null, null)).toHaveLength(5);
  });
});
