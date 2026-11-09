// The challenge metrics beyond strength: consistency (days trained, training time), running (distance, longest run, time) and cardio (time, distance,
// cycling, rowing). Pure scoring in lib/challenges.ts, no datastore. What this proves: every metric has a category, a unit and a name; each rule counts exactly
// the entries it should (an entry with no cardio type is a run; bike and rowing are their own); half-filled entries add nothing instead of failing; distances
// are kilometres to one decimal and times whole minutes; only workouts inside the dates count; a member who switched the leaderboard off, or has nothing
// scored, is not listed; and two members with the same name stay two rows.
import { describe, expect, it } from "vitest";

import {
  CHALLENGE_CATEGORIES,
  CHALLENGE_METRICS,
  CHALLENGE_METRIC_LABEL,
  CHALLENGE_METRIC_UNIT,
  scoreChallenge,
  scoreSessions,
  type ChallengeMetric,
} from "@/lib/challenges";
import type { WorkoutRunEntry, WorkoutSessionRecord } from "@/lib/db";
import type { LeaderboardMemberInput } from "@/lib/leaderboard";

const T = "2026-01-01T00:00:00.000Z";

function run(over: Partial<WorkoutRunEntry> = {}): WorkoutRunEntry {
  return { distance: 5, distanceUnit: "km", durationSecs: 1800, reps: null, sets: null, notes: null, ...over };
}

function session(date: string, runs: WorkoutRunEntry[] = [], over: Partial<WorkoutSessionRecord> = {}): WorkoutSessionRecord {
  return { id: `s-${date}-${runs.length}-${Math.random().toString(36).slice(2, 6)}`, userId: "u", date, title: "Session", durationMins: null, notes: null, exercises: [], runs, createdAt: T, updatedAt: T, ...over } as WorkoutSessionRecord;
}

function member(userId: string, fullName: string, sessions: WorkoutSessionRecord[], privacy?: LeaderboardMemberInput["privacy"]): LeaderboardMemberInput {
  return { userId, fullName, sessions, currentWeightKg: null, privacy };
}

describe("the metric catalogue", () => {
  it("every metric is in exactly one category, with a unit and a name, and the categories list nothing else", () => {
    const listed = CHALLENGE_CATEGORIES.flatMap((c) => [...c.metrics]);
    expect([...listed].sort()).toEqual([...CHALLENGE_METRICS].sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const m of CHALLENGE_METRICS) {
      expect(CHALLENGE_METRIC_UNIT[m]).toMatch(/^(kg|km|min|days)$/);
      expect(CHALLENGE_METRIC_LABEL[m].length).toBeGreaterThan(3);
    }
  });

  it("groups them as Strength, Consistency, Running and Cardio, in that order", () => {
    expect(CHALLENGE_CATEGORIES.map((c) => c.label)).toEqual(["Strength", "Consistency", "Running", "Cardio"]);
  });
});

describe("running", () => {
  const sessions = [
    session("2026-11-02", [run({ distance: 5.04, durationSecs: 1500 }), run({ cardioType: "run", distance: 10, durationSecs: 3000 })]),
    session("2026-11-03", [run({ cardioType: "bike", distance: 20, durationSecs: 3600 }), run({ cardioType: "walk", distance: 3, durationSecs: 2000 })]),
  ];

  it("counts runs and untyped (older) entries, and nothing else", () => {
    expect(scoreSessions("run_distance", sessions)).toBe(15); // 5.04 + 10 = 15.04, to one decimal
    expect(scoreSessions("run_time", sessions)).toBe(75); // (1500 + 3000) / 60
  });

  it("longest run is the biggest single entry, not a total", () => {
    expect(scoreSessions("run_longest", sessions)).toBe(10);
  });

  it("a half-filled entry adds nothing instead of breaking the score", () => {
    const partial = [session("2026-11-02", [run({ distance: null, durationSecs: 1200 }), run({ distance: 4, durationSecs: null })])];
    expect(scoreSessions("run_distance", partial)).toBe(4);
    expect(scoreSessions("run_time", partial)).toBe(20);
    expect(scoreSessions("run_longest", partial)).toBe(4);
  });

  it("nobody who only cycled or walked has a running score", () => {
    const other = [session("2026-11-02", [run({ cardioType: "bike" }), run({ cardioType: "walk" })])];
    expect(scoreSessions("run_distance", other)).toBe(0);
    expect(scoreSessions("run_longest", other)).toBe(0);
    expect(scoreSessions("run_time", other)).toBe(0);
  });
});

describe("cardio", () => {
  const sessions = [
    session("2026-11-02", [
      run({ distance: 5, durationSecs: 1800 }),
      run({ cardioType: "bike", distance: 20.25, durationSecs: 3600 }),
      run({ cardioType: "rower", distance: 2.5, durationSecs: 600 }),
      run({ cardioType: "stair_climber", distance: null, durationSecs: 900 }),
    ]),
  ];

  it("all-cardio time and distance count every type", () => {
    expect(scoreSessions("cardio_time", sessions)).toBe(115); // 1800 + 3600 + 600 + 900 = 6900 s = 115 min
    expect(scoreSessions("cardio_distance", sessions)).toBe(27.8); // 5 + 20.25 + 2.5 = 27.75
  });

  it("cycling and rowing distance are their own", () => {
    expect(scoreSessions("bike_distance", sessions)).toBe(20.3);
    expect(scoreSessions("row_distance", sessions)).toBe(2.5);
  });
});

describe("consistency", () => {
  it("workouts counts days trained: several sessions on one day count once, an empty session counts for nothing", () => {
    const s = [
      session("2026-11-02", [run()]),
      session("2026-11-02", [run()]),
      session("2026-11-03", []),
      session("2026-11-04", [], { exercises: [{ exerciseId: null, name: "Squat", weight: "100", reps: 5, sets: 3 }] as never }),
    ];
    expect(scoreSessions("workouts", s)).toBe(2);
  });

  it("training time adds the session durations and ignores a session without one", () => {
    const s = [session("2026-11-02", [], { durationMins: 45 }), session("2026-11-03", [], { durationMins: 30 }), session("2026-11-04", [], { durationMins: null })];
    expect(scoreSessions("training_time", s)).toBe(75);
  });
});

describe("scoreChallenge", () => {
  const start = "2026-11-02";
  const end = "2026-11-08";

  it("only workouts inside the dates count", () => {
    const m = member("a", "Alex", [session("2026-11-01", [run({ distance: 100 })]), session("2026-11-05", [run({ distance: 5 })]), session("2026-11-09", [run({ distance: 100 })])]);
    expect(scoreChallenge("run_distance", [m], start, end)).toMatchObject([{ userId: "a", value: 5 }]);
  });

  it("ranks highest first, leaves out a member with nothing scored, and a member who switched the leaderboard off", () => {
    const entries = scoreChallenge(
      "run_distance",
      [
        member("a", "Low", [session("2026-11-03", [run({ distance: 3 })])]),
        member("b", "High", [session("2026-11-03", [run({ distance: 12 })])]),
        member("c", "Nothing", [session("2026-11-03", [run({ cardioType: "bike", distance: 50 })])]),
        member("d", "Hidden", [session("2026-11-03", [run({ distance: 99 })])], { leaderboardVisible: false } as never),
      ],
      start,
      end
    );
    expect(entries.map((e) => [e.userId, e.value])).toEqual([["b", 12], ["a", 3]]);
  });

  it("two members who share a name are two rows", () => {
    const entries = scoreChallenge(
      "cardio_time",
      [member("a", "Sam Kay", [session("2026-11-03", [run({ durationSecs: 600 })])]), member("b", "Sam Kay", [session("2026-11-03", [run({ durationSecs: 1200 })])])],
      start,
      end
    );
    expect(entries.map((e) => e.userId)).toEqual(["b", "a"]);
  });

  it("the strength metrics still come from the leaderboard, unchanged", () => {
    const squat = (kg: number) => session("2026-11-03", [], { exercises: [{ exerciseId: null, name: "Back Squat", weight: `${kg}`, reps: 5, sets: 3 }] as never });
    const entries = scoreChallenge("squat", [member("a", "A", [squat(100)]), member("b", "B", [squat(140)])], start, end);
    expect(entries.map((e) => e.userId)).toEqual(["b", "a"]);
    const volume = scoreChallenge("volume", [member("a", "A", [squat(100)])], start, end);
    expect(volume[0].value).toBe(1500);
  });

  it.each(CHALLENGE_METRICS as readonly ChallengeMetric[])("%s never throws on a member with no sessions", (metric) => {
    expect(scoreChallenge(metric, [member("a", "A", [])], start, end)).toEqual([]);
  });
});
