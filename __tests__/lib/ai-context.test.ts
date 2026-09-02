import { describe, expect, it } from "vitest";

import type { RecoveryLogRecord, WorkoutSessionRecord } from "@/lib/db";
import type { ProfileRecord } from "@/lib/profile-schema";
import { buildCoachingContext, summarizeFamiliarLifts } from "@/lib/ai-context";

const TODAY = new Date().toISOString().slice(0, 10);

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function makeProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    userId: "user-1",
    fullName: "Alex Rivera",
    email: "alex@demo.local",
    phone: "123",
    dateOfBirth: null,
    gender: "Male",
    primaryGoal: "Build Muscle",
    sportPlayed: null,
    currentWeightKg: 78,
    additionalInfo: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContact2Name: null,
    emergencyContact2Phone: null,
    cycleTrackingEligible: false,
    cycleTrackingEnabled: false,
    menopauseSupportEnabled: false,
    reminderTimingsMins: null,
    emailNotificationsEnabled: true,
    pushNotificationsEnabled: false,
    preferredUnits: "metric",
    onboardingCompleted: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRecoveryLog(
  date: string,
  overrides: Partial<RecoveryLogRecord> = {}
): RecoveryLogRecord {
  return {
    id: `rec-${date}`,
    userId: "user-1",
    date,
    sleepHours: 7.5,
    sleepQuality: 4,
    soreness: 2,
    fatigue: 2,
    trainingDurationMins: 60,
    rpe: 7,
    goal: null,
    notes: null,
    readinessScore: 82,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T08:00:00.000Z`,
    ...overrides,
  };
}

function makeSession(
  date: string,
  exercises: { name: string; weight: string | null; reps: number | null; sets: number | null }[]
): WorkoutSessionRecord {
  return {
    id: `session-${date}`,
    userId: "user-1",
    date,
    title: "Strength session",
    durationMins: 55,
    notes: null,
    exercises: exercises.map((ex) => ({
      exerciseId: null,
      name: ex.name,
      weight: ex.weight,
      reps: ex.reps,
      sets: ex.sets,
      notes: null,
    })),
    runs: [],
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
  };
}

describe("summarizeFamiliarLifts", () => {
  it("ranks lifts by how often they were logged and anchors to the most recent performance", () => {
    const sessions = [
      makeSession(isoDaysAgo(1), [{ name: "Back Squat", weight: "82.5", reps: 5, sets: 5 }]),
      makeSession(isoDaysAgo(8), [
        { name: "Back Squat", weight: "80", reps: 5, sets: 5 },
        { name: "Bench Press", weight: "60", reps: 8, sets: 3 },
      ]),
      makeSession(isoDaysAgo(15), [{ name: "Back Squat", weight: "77.5", reps: 5, sets: 5 }]),
    ];

    const lifts = summarizeFamiliarLifts(sessions);

    expect(lifts[0].name).toBe("Back Squat");
    expect(lifts[0].timesLogged).toBe(3);
    // Most recent performance, not the oldest
    expect(lifts[0].last.weight).toBe("82.5");
    expect(lifts[1].name).toBe("Bench Press");
  });

  it("returns an empty list with no history", () => {
    expect(summarizeFamiliarLifts([])).toEqual([]);
  });
});

describe("buildCoachingContext — grounding categories", () => {
  const profile = makeProfile();
  const recoveryLogs = [
    makeRecoveryLog(TODAY, { readinessScore: 82, sleepHours: 7.5, trainingDurationMins: 60, rpe: 7 }),
    makeRecoveryLog(isoDaysAgo(1), { trainingDurationMins: 45, rpe: 6 }),
    makeRecoveryLog(isoDaysAgo(2), { trainingDurationMins: 30, rpe: 5 }),
  ];
  const sessions = [
    makeSession(isoDaysAgo(1), [{ name: "Back Squat", weight: "82.5", reps: 5, sets: 5 }]),
    makeSession(isoDaysAgo(4), [{ name: "Bench Press", weight: "60", reps: 8, sets: 3 }]),
  ];

  const context = buildCoachingContext({
    profile,
    recoveryLogs,
    sessions,
    todayISO: TODAY,
    weeklyTrainingSchedule: null,
    upcomingBookings: [],
  });

  it("includes member profile context", () => {
    expect(context.text).toContain("Alex Rivera");
    expect(context.text).toContain("Build Muscle");
    expect(context.text).toContain("78 kg");
    expect(context.text).toContain("metric");
  });

  it("includes today's readiness and recovery inputs", () => {
    expect(context.text).toContain("Readiness score: 82/100");
    expect(context.text).toContain("Sleep: 7.5 h");
    expect(context.display.readinessScore).toBe(82);
  });

  it("includes the rolling 7-day load with the exact computed sum", () => {
    // 60*7 + 45*6 + 30*5 = 420 + 270 + 150 = 840
    expect(context.text).toContain("840");
    expect(context.text).toContain("Days with logged load: 3");
    expect(context.display.loadBand).toBe("light");
  });

  it("includes workout history and familiar lifts with real logged values", () => {
    expect(context.text).toContain("Total sessions logged: 2");
    expect(context.text).toContain("Back Squat");
    expect(context.text).toContain("5 x 5 @ 82.5 kg");
    expect(context.text).toContain("3 x 8 @ 60 kg");
  });

  it("includes the Workout Helper tier decision for today", () => {
    // Readiness 82 + light load → full session
    expect(context.display.tierLabel).toBe("Full session");
    expect(context.text).toContain("Tier: full");
  });

  it("contains no numbers that were not supplied", () => {
    // Every kg figure in the text must come from the inputs above.
    const kgValues = [...context.text.matchAll(/([\d.]+)\s*kg/g)].map((m) => m[1]);
    const allowed = new Set(["78", "82.5", "60"]);
    for (const value of kgValues) {
      expect(allowed.has(value), `unexpected kg value "${value}" in context`).toBe(true);
    }
  });
});

describe("buildCoachingContext — missing data is stated, never invented", () => {
  it("says there is no recovery log today instead of fabricating one", () => {
    const context = buildCoachingContext({
      profile: makeProfile(),
      recoveryLogs: [],
      sessions: [],
      todayISO: TODAY,
      weeklyTrainingSchedule: null,
      upcomingBookings: [],
    });

    expect(context.text).toContain("No recovery log for today");
    expect(context.text).toContain("No training load logged in the last 7 days");
    expect(context.text).toContain("No workouts logged yet");
    expect(context.display.readinessScore).toBeNull();
    expect(context.display.loadBand).toBe("none");
    expect(context.display.sessionCount).toBe(0);
    // No readiness number should appear anywhere
    expect(context.text).not.toMatch(/Readiness score: \d/);
  });

  it("keeps a stale (yesterday) recovery log out of today's readiness", () => {
    const context = buildCoachingContext({
      profile: makeProfile(),
      recoveryLogs: [makeRecoveryLog(isoDaysAgo(1), { readinessScore: 91 })],
      sessions: [],
      todayISO: TODAY,
      weeklyTrainingSchedule: null,
      upcomingBookings: [],
    });

    expect(context.display.readinessScore).toBeNull();
    expect(context.text).toContain("No recovery log for today");
    expect(context.text).not.toContain("91/100");
  });

  it("stays conservative when readiness is low — reduced tier is surfaced", () => {
    const context = buildCoachingContext({
      profile: makeProfile(),
      recoveryLogs: [makeRecoveryLog(TODAY, { readinessScore: 38 })],
      sessions: [],
      todayISO: TODAY,
      weeklyTrainingSchedule: null,
      upcomingBookings: [],
    });

    expect(context.display.tierLabel).toBe("Reduced session");
    expect(context.text).toContain("Tier: reduced");
    expect(context.text.toLowerCase()).toContain("reduced volume");
  });

  it("downgrades an otherwise-full tier when a heavy session is already booked/planned today", () => {
    const todayWeekday = new Date(`${TODAY}T00:00:00Z`).getUTCDay();
    const context = buildCoachingContext({
      profile: makeProfile(),
      recoveryLogs: [makeRecoveryLog(TODAY, { readinessScore: 82 })], // would be "full" alone
      sessions: [],
      todayISO: TODAY,
      weeklyTrainingSchedule: {
        userId: "user-1",
        updatedAt: TODAY,
        sessions: [
          {
            id: "wt-1",
            dayOfWeek: todayWeekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
            label: "Match day",
            activityType: "sport",
            timeOfDay: null,
            intensity: "heavy",
            estimatedDurationMins: null,
            notes: null,
            recurring: true,
            weekOf: null,
            sourceBookingId: null,
          },
        ],
      },
      upcomingBookings: [],
    });

    expect(context.display.tierLabel).not.toBe("Full session");
    expect(context.text).toContain("booked or planned");
  });
});

describe("buildCoachingContext — drink calculator grounding", () => {
  const baseInput = () => ({
    profile: makeProfile({ currentWeightKg: 75 }),
    recoveryLogs: [],
    sessions: [],
    todayISO: TODAY,
    weeklyTrainingSchedule: null,
    upcomingBookings: [],
  });

  it("omits the drink section when no settings are provided", () => {
    const context = buildCoachingContext(baseInput());
    expect(context.text).not.toContain("Sports performance drink");
  });

  it("grounds the drink section in the member's actual mix for a team sport", () => {
    const context = buildCoachingContext({
      ...baseInput(),
      drinkSettings: {
        sport: "soccer",
        role: "cm",
        durationIdx: 1,
        runKm: 10,
        runEffort: "steady",
        bottleMl: 1000,
        sweat: "medium",
        temp: "cool",
      },
    });

    expect(context.text).toContain("Sports performance drink");
    expect(context.text).toContain("Soccer — Centre Mid, 90 min");
    expect(context.text).toContain("1000 ml bottle | medium sweat profile | cool conditions");
    // Real calculator numbers: 75 kg → 30 g malto; medium/cool 90 min → salt 1.02 g
    expect(context.text).toContain("maltodextrin 30 g");
    expect(context.text).toContain("salt 1.02 g");
    expect(context.text).toContain("base target 400 mg sodium per litre");
    expect(context.text).toContain("Pre-match 280 ml");
  });

  it("describes run mode with derived duration and carry advice", () => {
    const context = buildCoachingContext({
      ...baseInput(),
      drinkSettings: {
        sport: "run",
        role: "",
        durationIdx: 0,
        runKm: 3,
        runEffort: "easy",
        bottleMl: 500,
        sweat: "low",
        temp: "cool",
      },
    });

    expect(context.text).toContain("Run — 3 km at easy effort (estimated 20 min)");
    expect(context.text).toContain("No carried drink needed");
  });

  it("scales the drink mix with the member's synced body weight", () => {
    const context = buildCoachingContext({
      ...baseInput(),
      profile: makeProfile({ currentWeightKg: 90 }),
      drinkSettings: {
        sport: "soccer",
        role: "cm",
        durationIdx: 1,
        runKm: 10,
        runEffort: "steady",
        bottleMl: 1000,
        sweat: "medium",
        temp: "cool",
      },
    });

    expect(context.text).toContain("maltodextrin 36 g"); // 90 × 0.4
    expect(context.text).toContain("beta-alanine 2 g"); // >85 kg band
  });
});
