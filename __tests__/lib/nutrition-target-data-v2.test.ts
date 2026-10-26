// Nutrition targets v2, slice C: the resolver end to end on synthetic
// records (docs/nutrition-targets-v2-plan-2026-10.md). Only the datastore and
// the tier lookup are mocked; the engine, trend and plan code are real.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findProfileByUserId: vi.fn(),
  findBodyWeightLogsByUserId: vi.fn(),
  findBodyFatLogsByUserId: vi.fn(),
  findRecoveryLogsByUserId: vi.fn(),
  findWeeklyTrainingScheduleByUserId: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
  findFoodEntriesByUserId: vi.fn(),
  findNutritionDayStatusesByUserId: vi.fn(),
  findNutritionTargetByUserId: vi.fn(),
  findCycleSettingsByUserId: vi.fn(),
  findPregnancyStatusByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const { mockTier } = vi.hoisted(() => ({ mockTier: vi.fn() }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveMemberTierForUser: mockTier }));

import { getResolvedNutritionTarget, getResolvedNutritionTargetsForWeek } from "@/lib/nutrition-target-data";

const USER = "member-1";
const TODAY = "2026-10-28"; // a Wednesday; week starts Monday 2026-10-26

function isoDaysFrom(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Female, 60 kg, 165 cm, 30 at the time, "Weight Loss" — the plan's worked example.
const PROFILE = {
  userId: USER,
  gender: "Female",
  dateOfBirth: "1996-01-01",
  heightCm: 165,
  currentWeightKg: 60,
  primaryGoal: "Weight Loss",
  goalPacePctPerWeek: null,
  calorieDistribution: null,
  goalTargetDate: null,
  goalWeightKg: null,
  goalBodyFatPct: null,
  bodyFatPct: null,
  cycleTrackingEnabled: false,
};

// Gym sessions Mon/Wed/Fri at moderate intensity.
const SCHEDULE = {
  sessions: [1, 3, 5].map((dayOfWeek) => ({
    id: `s${dayOfWeek}`,
    dayOfWeek,
    label: "Gym",
    activityType: "gym",
    timeOfDay: null,
    intensity: "moderate",
    estimatedDurationMins: null,
    notes: null,
    recurring: true,
    weekOf: null,
    sourceBookingId: null,
    sourceProgramId: null,
  })),
};

// Weighs in daily at a steady 60 kg and logs about 1,300 kcal on two meal
// slots — the under-logging pattern that used to drag the target down.
function partialLoggingHistory(days: number) {
  const weights = [];
  const food = [];
  for (let i = days; i >= 1; i--) {
    const date = isoDaysFrom(TODAY, -i);
    weights.push({ id: `w${i}`, userId: USER, date, weightKg: 60, createdAt: `${date}T07:00:00Z` });
    food.push({ id: `f${i}a`, userId: USER, date, mealType: "lunch", calories: 650 });
    food.push({ id: `f${i}b`, userId: USER, date, mealType: "dinner", calories: 650 });
  }
  return { weights, food };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findProfileByUserId.mockReturnValue({ ...PROFILE });
  h.findBodyWeightLogsByUserId.mockReturnValue([]);
  h.findBodyFatLogsByUserId.mockReturnValue([]);
  h.findRecoveryLogsByUserId.mockReturnValue([]);
  h.findWeeklyTrainingScheduleByUserId.mockReturnValue(SCHEDULE);
  h.findWorkoutSessionsByUserId.mockReturnValue([]);
  h.findFoodEntriesByUserId.mockReturnValue([]);
  h.findNutritionDayStatusesByUserId.mockReturnValue([]);
  h.findNutritionTargetByUserId.mockReturnValue(undefined);
  h.findCycleSettingsByUserId.mockReturnValue(undefined);
  mockTier.mockReturnValue("app_subscription");
});

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("v2 resolver", () => {
  it("gives a general member an even week that sums to the weekly budget", () => {
    const week = getResolvedNutritionTargetsForWeek(USER, TODAY, TODAY)!;
    const kcal = week.days.map((d) => d.calories!);
    expect(new Set(kcal).size).toBe(1);
    expect(sum(kcal)).toBe(week.days[0].weekBudgetKcal);
    expect(week.days[0]).toMatchObject({
      weekStart: "2026-10-26",
      distribution: "even",
      distributionSource: "default",
      expenditureSource: "formula",
      source: "estimated",
      pacePctPerWeek: -0.5,
      paceLimited: false,
    });
  });

  it("spreads by training for Membership-tier members, same weekly total", () => {
    mockTier.mockReturnValue("membership");
    const week = getResolvedNutritionTargetsForWeek(USER, TODAY, TODAY)!;
    const kcal = week.days.map((d) => d.calories!);
    expect(week.days[0].distribution).toBe("training");
    expect(sum(kcal)).toBe(week.days[0].weekBudgetKcal);
    expect(Math.max(...kcal)).toBeGreaterThan(Math.min(...kcal));
  });

  it("ignores partial food days, so under-logging no longer pulls the target down", () => {
    const { weights, food } = partialLoggingHistory(35);
    h.findBodyWeightLogsByUserId.mockReturnValue(weights);
    h.findFoodEntriesByUserId.mockReturnValue(food);
    const target = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    expect(target.expenditureSource).toBe("formula");
    expect(target.completeDaysLast14).toBe(0);
    // Exactly the same as having logged nothing at all.
    h.findFoodEntriesByUserId.mockReturnValue([]);
    expect(getResolvedNutritionTarget(USER, TODAY, TODAY)!.dailyAverageKcal).toBe(target.dailyAverageKcal);
    // And well above the old engine's ~1,080 kcal for this profile.
    expect(target.dailyAverageKcal!).toBeGreaterThanOrEqual(1400);
  });

  it("learns from the same days once the member marks them complete", () => {
    const { weights, food } = partialLoggingHistory(35);
    h.findBodyWeightLogsByUserId.mockReturnValue(weights);
    h.findFoodEntriesByUserId.mockReturnValue(food);
    h.findNutritionDayStatusesByUserId.mockReturnValue(
      weights.map((w) => ({ id: `d-${w.date}`, userId: USER, date: w.date, status: "complete", updatedAt: "x" }))
    );
    const target = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    expect(target.expenditureSource).toBe("learned");
    expect(target.source).toBe("adaptive");
  });

  it("never takes yesterday's overeating off today", () => {
    const before = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    h.findFoodEntriesByUserId.mockReturnValue([
      { id: "big", userId: USER, date: isoDaysFrom(TODAY, -1), mealType: "dinner", calories: 4000 },
    ]);
    const after = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    expect(after.calories).toBe(before.calories);
  });

  it("uses the member's pace and distribution choices", () => {
    h.findProfileByUserId.mockReturnValue({ ...PROFILE, goalPacePctPerWeek: -0.25, calorieDistribution: "training" });
    const target = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    expect(target).toMatchObject({ pacePctPerWeek: -0.25, distribution: "training", distributionSource: "member" });
  });

  it("a coach lock beats the member's choice", () => {
    h.findProfileByUserId.mockReturnValue({ ...PROFILE, calorieDistribution: "even" });
    h.findNutritionTargetByUserId.mockReturnValue({ mode: "auto", distribution: "training", distributionLocked: true });
    const target = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    expect(target).toMatchObject({ distribution: "training", distributionSource: "coach-locked" });
    expect(target.rationale!.join(" ")).toContain("set by your coach");
  });

  it("slows an aggressive pace to the minimum and says so", () => {
    h.findProfileByUserId.mockReturnValue({ ...PROFILE, goalPacePctPerWeek: -1 });
    const target = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    expect(target.paceLimited).toBe(true);
    expect(target.dailyAverageKcal!).toBeGreaterThanOrEqual(1200);
    expect(target.rationale!.join(" ")).toContain("slowed your pace");
  });

  it("leaves a coach's fixed target exactly as set", () => {
    h.findNutritionTargetByUserId.mockReturnValue({
      userId: USER,
      mode: "manual",
      calories: 2100,
      proteinG: 140,
      carbsG: 230,
      fatG: 70,
      setByStaffId: "coach",
      notes: null,
    });
    const target = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    expect(target).toMatchObject({ mode: "manual", calories: 2100, weekBudgetKcal: null, distribution: null });
  });

  it("returns no number without a weight on file", () => {
    h.findProfileByUserId.mockReturnValue({ ...PROFILE, currentWeightKg: null });
    expect(getResolvedNutritionTarget(USER, TODAY, TODAY)).toMatchObject({ mode: "auto", calories: null, weekBudgetKcal: null });
  });

  it("a stated activity level sets the starting burn", () => {
    h.findProfileByUserId.mockReturnValue({ ...PROFILE, activityLevel: "light" });
    const target = getResolvedNutritionTarget(USER, TODAY, TODAY)!;
    // Resting 1,320 x 1.375 = 1,815; Moderate loss -330 -> 1,485.
    expect(target.expenditureKcal).toBe(1815);
    expect(target.dailyAverageKcal).toBe(1485);
    expect(target.rationale!.join(" ")).toContain("how active you said you are");
  });

  it("macros always add up to the day's calories within rounding", () => {
    mockTier.mockReturnValue("membership");
    for (const d of getResolvedNutritionTargetsForWeek(USER, TODAY, TODAY)!.days) {
      const fromMacros = d.proteinG! * 4 + d.carbsG! * 4 + d.fatG! * 9;
      expect(Math.abs(fromMacros - d.calories!)).toBeLessThanOrEqual(6);
    }
  });
});
