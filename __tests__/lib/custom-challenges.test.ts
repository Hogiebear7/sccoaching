// Custom challenges: the setter names an exercise (or picks an activity) and what to measure. Pure rules in lib/challenges.ts, no datastore.
// What this proves: an exercise name matches by its words ("front squat" finds "Barbell Front Squat", not "Back Squat"); what a setter can send is validated;
// strength measures read the real sets and skip warm-ups; cardio measures read the chosen activity only; a fastest time counts runs within 1% under to 5% over the
// target distance and ranks lowest first; and half-filled entries add nothing.
import { describe, expect, it } from "vitest";

import {
  challengeLabel,
  challengeLowerIsBetter,
  challengeUnit,
  customChallengeLabel,
  exerciseMatches,
  parseCustomChallenge,
  scoreChallenge,
  scoreCustom,
  type CustomChallenge,
} from "@/lib/challenges";
import type { WorkoutRunEntry, WorkoutSessionRecord } from "@/lib/db";
import type { LeaderboardMemberInput } from "@/lib/leaderboard";

const T = "2026-01-01T00:00:00.000Z";

type Ex = WorkoutSessionRecord["exercises"][number];
const ex = (name: string, over: Partial<Ex> = {}): Ex => ({ exerciseId: null, name, weight: null, reps: null, sets: null, ...over }) as Ex;
const run = (over: Partial<WorkoutRunEntry> = {}): WorkoutRunEntry => ({ distance: 5, distanceUnit: "km", durationSecs: 1500, reps: null, sets: null, notes: null, ...over });
const session = (exercises: Ex[] = [], runs: WorkoutRunEntry[] = [], date = "2026-11-03"): WorkoutSessionRecord =>
  ({ id: `s-${Math.random().toString(36).slice(2, 7)}`, userId: "u", date, title: "S", durationMins: null, notes: null, exercises, runs, createdAt: T, updatedAt: T }) as WorkoutSessionRecord;

const strength = (measure: CustomChallenge["measure"], subject = "Front squat"): CustomChallenge => ({ measure, subject, cardioType: null, targetDistanceKm: null });
const cardio = (measure: CustomChallenge["measure"], cardioType: CustomChallenge["cardioType"], target: number | null = null): CustomChallenge => ({
  measure,
  subject: "x",
  cardioType,
  targetDistanceKm: target,
});

describe("exerciseMatches", () => {
  it("every word typed must be in the logged name, in any order, ignoring case and punctuation", () => {
    expect(exerciseMatches("Barbell Front Squat", "front squat")).toBe(true);
    expect(exerciseMatches("Squat (front)", "Front Squat")).toBe(true);
    expect(exerciseMatches("FRONT-SQUAT", "front squat")).toBe(true);
    expect(exerciseMatches("Back Squat", "front squat")).toBe(false);
    expect(exerciseMatches("Front Raise", "front squat")).toBe(false);
  });
  it("a plural matches a singular, and one word is enough to match several exercises", () => {
    expect(exerciseMatches("Pull-ups", "pull up")).toBe(true);
    expect(exerciseMatches("Front Squats", "front squat")).toBe(true);
    expect(exerciseMatches("Back Squat", "squat")).toBe(true);
    expect(exerciseMatches("Front Squat", "squat")).toBe(true);
  });
  it("an empty or symbol-only subject matches nothing", () => {
    expect(exerciseMatches("Back Squat", "")).toBe(false);
    expect(exerciseMatches("Back Squat", "  ?! ")).toBe(false);
  });
});

describe("parseCustomChallenge", () => {
  it("a strength challenge needs an exercise of 2 to 40 characters with a letter, and tidies the spacing", () => {
    expect(parseCustomChallenge({ measure: "best_weight", subject: "  Front   squat " })).toEqual({ ok: true, custom: strength("best_weight", "Front squat") });
    for (const subject of ["", "a", "x".repeat(41), "123", undefined]) {
      expect(parseCustomChallenge({ measure: "best_weight", subject }), String(subject)).toMatchObject({ ok: false, message: expect.stringMatching(/exercise/i) });
    }
    expect(parseCustomChallenge({ measure: "best_weight", subject: "x".repeat(40) }).ok).toBe(true);
  });

  it("a cardio challenge needs an activity from the list; its name is made for it", () => {
    expect(parseCustomChallenge({ measure: "total_distance", cardioType: "bike" })).toEqual({
      ok: true,
      custom: { measure: "total_distance", subject: "Bike", cardioType: "bike", targetDistanceKm: null },
    });
    expect(parseCustomChallenge({ measure: "total_distance", cardioType: "swim" })).toMatchObject({ ok: false, message: "Choose the activity." });
    expect(parseCustomChallenge({ measure: "total_time" })).toMatchObject({ ok: false });
  });

  it("a fastest time needs a distance between 0.1 and 100 km, rounded to two decimals, and names itself from it", () => {
    expect(parseCustomChallenge({ measure: "fastest_time", cardioType: "run", targetDistanceKm: 5 })).toEqual({
      ok: true,
      custom: { measure: "fastest_time", subject: "5 km Run", cardioType: "run", targetDistanceKm: 5 },
    });
    expect(parseCustomChallenge({ measure: "fastest_time", cardioType: "run", targetDistanceKm: 21.0975 })).toMatchObject({ ok: true, custom: { targetDistanceKm: 21.1, subject: "21.1 km Run" } });
    for (const targetDistanceKm of [0, 0.05, 100.5, -3, "5", null, undefined, NaN]) {
      expect(parseCustomChallenge({ measure: "fastest_time", cardioType: "run", targetDistanceKm }), String(targetDistanceKm)).toMatchObject({ ok: false, message: expect.stringMatching(/distance/i) });
    }
    // The distance is ignored by the other cardio measures.
    expect(parseCustomChallenge({ measure: "total_time", cardioType: "run", targetDistanceKm: 5 })).toMatchObject({ ok: true, custom: { targetDistanceKm: null } });
  });

  it("an unknown measure, or nothing at all, is refused", () => {
    expect(parseCustomChallenge({ measure: "best_vibes", subject: "Squat" })).toMatchObject({ ok: false, message: "Choose what to measure." });
    expect(parseCustomChallenge(undefined)).toMatchObject({ ok: false });
  });
});

describe("how a custom challenge is read", () => {
  it("has a plain name, a unit and a direction", () => {
    expect(customChallengeLabel(strength("best_weight"))).toBe("Front squat: best weight");
    expect(customChallengeLabel(strength("best_reps", "Pull up"))).toBe("Pull up: most reps in a set");
    expect(customChallengeLabel({ ...cardio("fastest_time", "run", 5), subject: "5 km Run" })).toBe("5 km Run: fastest time");
    expect(customChallengeLabel(cardio("total_distance", "rower"))).toBe("Rower: total distance");
    expect(challengeLabel("custom", strength("total_volume"))).toBe("Front squat: total volume");
    expect(challengeLabel("custom", null)).toBe("Custom challenge");
    expect(challengeLabel("run_distance", null)).toBe("Running distance");

    expect(challengeUnit("custom", strength("best_weight"))).toBe("kg");
    expect(challengeUnit("custom", strength("total_reps"))).toBe("reps");
    expect(challengeUnit("custom", cardio("total_distance", "bike"))).toBe("km");
    expect(challengeUnit("custom", cardio("total_time", "bike"))).toBe("min");
    expect(challengeUnit("custom", cardio("fastest_time", "run", 5))).toBe("secs");
    expect(challengeUnit("squat", null)).toBe("kg");

    expect(challengeLowerIsBetter("custom", cardio("fastest_time", "run", 5))).toBe(true);
    expect(challengeLowerIsBetter("custom", strength("best_weight"))).toBe(false);
    expect(challengeLowerIsBetter("volume", null)).toBe(false);
  });
});

describe("strength measures", () => {
  const sessions = [
    session([
      ex("Barbell Front Squat", { setDetails: [{ weight: "40", reps: 10, setType: "warmup" }, { weight: "80", reps: 5 }, { weight: "90", reps: 3 }] }),
      ex("Back Squat", { weight: "200", reps: 5, sets: 3 }), // a different exercise: never counts for "front squat"
    ]),
    session([ex("Front Squat", { weight: "70.5 kg", reps: 8, sets: 2 })], [], "2026-11-04"),
  ];

  it("best weight is the heaviest working set, warm-ups excluded", () => {
    expect(scoreCustom(strength("best_weight"), sessions)).toBe(90);
  });
  it("total volume adds weight times reps over every working set, with a summary entry standing for its sets", () => {
    // 80*5 + 90*3 = 670, plus 70.5*8*2 = 1128
    expect(scoreCustom(strength("total_volume"), sessions)).toBe(1798);
  });
  it("most reps is the best single set, total reps the sum", () => {
    expect(scoreCustom(strength("best_reps"), sessions)).toBe(8);
    expect(scoreCustom(strength("total_reps"), sessions)).toBe(5 + 3 + 16);
  });
  it("one word covers every variation, so 'squat' includes the back squat", () => {
    expect(scoreCustom(strength("best_weight", "squat"), sessions)).toBe(200);
  });
  it("a bodyweight exercise has reps but no weight", () => {
    const pullups = [session([ex("Pull-ups", { weight: null, reps: 12, sets: 3 })])];
    expect(scoreCustom(strength("best_reps", "pull up"), pullups)).toBe(12);
    expect(scoreCustom(strength("total_reps", "pull up"), pullups)).toBe(36);
    expect(scoreCustom(strength("best_weight", "pull up"), pullups)).toBe(0);
  });
  it("a per-side set counts both sides as its reps", () => {
    const lunges = [session([ex("Split Squat", { setDetails: [{ weight: "20", reps: null, repsRight: 8, repsLeft: 8 }] })])];
    expect(scoreCustom(strength("best_reps", "split squat"), lunges)).toBe(16);
  });
  it("an exercise whose whole entry is a warm-up counts for nothing", () => {
    const warm = [session([ex("Front Squat", { weight: "100", reps: 5, sets: 3, setType: "warmup" })])];
    expect(scoreCustom(strength("best_weight"), warm)).toBe(0);
  });
  it("nothing matching scores 0", () => {
    expect(scoreCustom(strength("best_weight", "snatch"), sessions)).toBe(0);
    expect(scoreCustom(strength("best_weight"), [])).toBe(0);
  });
});

describe("cardio measures", () => {
  const sessions = [
    session([], [run({ distance: 5, durationSecs: 1500 }), run({ cardioType: "run", distance: 10.04, durationSecs: 3300 }), run({ cardioType: "bike", distance: 30, durationSecs: 3600 })]),
    session([], [run({ cardioType: "walk", distance: 4, durationSecs: 2700 }), run({ distance: null, durationSecs: 600 })], "2026-11-04"),
  ];

  it("reads only the chosen activity: an entry with no type is a run, and a bike is a bike", () => {
    expect(scoreCustom(cardio("total_distance", "run"), sessions)).toBe(15); // 5 + 10.04
    expect(scoreCustom(cardio("total_distance", "bike"), sessions)).toBe(30);
    expect(scoreCustom(cardio("total_distance", "walk"), sessions)).toBe(4);
    expect(scoreCustom(cardio("total_distance", "rower"), sessions)).toBe(0);
  });
  it("longest is one entry, time is whole minutes, and a half-filled entry adds nothing", () => {
    expect(scoreCustom(cardio("longest_distance", "run"), sessions)).toBe(10);
    expect(scoreCustom(cardio("total_time", "run"), sessions)).toBe(90); // 1500 + 3300 + 600 s
    expect(scoreCustom(cardio("total_time", "walk"), sessions)).toBe(45);
  });
  it("a cardio challenge with no activity scores nothing rather than guessing", () => {
    expect(scoreCustom(cardio("total_distance", null), sessions)).toBe(0);
  });
});

describe("fastest time over a distance", () => {
  const target = cardio("fastest_time", "run", 5);

  it("counts runs from 1% under to 5% over the distance, and takes the lowest time", () => {
    const s = [
      session([], [run({ distance: 4.94, durationSecs: 900 })]), // 1.2% short: too short
      session([], [run({ distance: 4.96, durationSecs: 1300 })]), // within 1%: counts
      session([], [run({ distance: 5.25, durationSecs: 1258 })]), // exactly 5% over: counts
      session([], [run({ distance: 5.26, durationSecs: 1000 })]), // too long
      session([], [run({ distance: 5.0, durationSecs: 1400 })]),
    ];
    expect(scoreCustom(target, s)).toBe(1258);
  });
  it("another activity, an entry with no time, or no run near the distance scores nothing", () => {
    expect(scoreCustom(target, [session([], [run({ cardioType: "bike", distance: 5, durationSecs: 600 })])])).toBe(0);
    expect(scoreCustom(target, [session([], [run({ distance: 5, durationSecs: null })])])).toBe(0);
    expect(scoreCustom(target, [session([], [run({ distance: 10, durationSecs: 2400 })])])).toBe(0);
  });
  it("without a target distance it scores nothing", () => {
    expect(scoreCustom(cardio("fastest_time", "run", null), [session([], [run()])])).toBe(0);
  });
});

describe("the standings", () => {
  const member = (userId: string, fullName: string, sessions: WorkoutSessionRecord[], privacy?: never): LeaderboardMemberInput => ({ userId, fullName, sessions, currentWeightKg: null, privacy });
  const start = "2026-11-02";
  const end = "2026-11-08";

  it("a time to beat ranks lowest first; a weight ranks highest first", () => {
    const times = scoreChallenge(
      "custom",
      [
        member("slow", "Slow", [session([], [run({ distance: 5, durationSecs: 1800 })])]),
        member("fast", "Fast", [session([], [run({ distance: 5, durationSecs: 1258 })])]),
        member("none", "None", [session([], [run({ distance: 3, durationSecs: 600 })])]),
      ],
      start,
      end,
      cardio("fastest_time", "run", 5)
    );
    expect(times.map((e) => [e.userId, e.value])).toEqual([["fast", 1258], ["slow", 1800]]);

    const weights = scoreChallenge(
      "custom",
      [member("a", "A", [session([ex("Front Squat", { weight: "100", reps: 3, sets: 1 })])]), member("b", "B", [session([ex("Front Squat", { weight: "120", reps: 1, sets: 1 })])])],
      start,
      end,
      strength("best_weight")
    );
    expect(weights.map((e) => e.userId)).toEqual(["b", "a"]);
  });

  it("only workouts inside the dates count, and a member who switched the leaderboard off is left out", () => {
    const entries = scoreChallenge(
      "custom",
      [
        member("in", "In", [session([ex("Front Squat", { weight: "100", reps: 1, sets: 1 })], [], "2026-11-05"), session([ex("Front Squat", { weight: "300", reps: 1, sets: 1 })], [], "2026-10-30")]),
        member("hidden", "Hidden", [session([ex("Front Squat", { weight: "200", reps: 1, sets: 1 })])], { leaderboardVisible: false } as never),
      ],
      start,
      end,
      strength("best_weight")
    );
    expect(entries.map((e) => [e.userId, e.value])).toEqual([["in", 100]]);
  });

  it("a custom challenge with no definition scores nobody", () => {
    expect(scoreChallenge("custom", [member("a", "A", [session([ex("Front Squat", { weight: "100", reps: 1, sets: 1 })])])], start, end, null)).toEqual([]);
  });
});
