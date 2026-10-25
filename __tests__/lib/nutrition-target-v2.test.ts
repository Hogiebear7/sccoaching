import { describe, expect, it } from "vitest";

import {
  activityExpenditureKcal,
  clampPace,
  defaultPaceForGoal,
  distributeWeek,
  formulaExpenditureKcal,
  isCompleteDay,
  learnExpenditure,
  minimumDailyAverageKcal,
  mondayOf,
  paceAdjustKcal,
  resolveDistribution,
  restingKcal,
  trendWeightByDate,
  weeklyBudget,
  type DiaryDay,
  type WeightPoint,
} from "@/lib/nutrition-target";
import type { FuelDay } from "@/lib/nutrition";

function isoDaysAfter(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function day(date: string, calories: number, extra: Partial<DiaryDay> = {}): DiaryDay {
  return { date, calories, mealSlotsLogged: 4, status: null, ...extra };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("mondayOf", () => {
  it("returns the Monday of the week", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(mondayOf("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(mondayOf("2026-10-21")).toBe("2026-10-19");
  });
});

describe("isCompleteDay", () => {
  it("counts a day the member marked complete, whatever was logged", () => {
    expect(isCompleteDay(day("2026-10-01", 900, { mealSlotsLogged: 1, status: "complete" }), 2000)).toBe(true);
  });
  it("never counts a day marked incomplete or with no food", () => {
    expect(isCompleteDay(day("2026-10-01", 2500, { status: "incomplete" }), 2000)).toBe(false);
    expect(isCompleteDay(day("2026-10-01", 0, { status: "complete" }), 2000)).toBe(false);
  });
  it("counts an unmarked day only when it looks complete", () => {
    expect(isCompleteDay(day("2026-10-01", 1300), 2000)).toBe(true); // 3+ slots, 65%
    expect(isCompleteDay(day("2026-10-01", 1100), 2000)).toBe(false); // 55%
    expect(isCompleteDay(day("2026-10-01", 1800, { mealSlotsLogged: 2 }), 2000)).toBe(false);
    expect(isCompleteDay(day("2026-10-01", 1800), null)).toBe(false);
  });
});

describe("trendWeightByDate", () => {
  it("starts at the first weigh-in and smooths towards later ones", () => {
    const trend = trendWeightByDate(
      [
        { date: "2026-10-01", weightKg: 80 },
        { date: "2026-10-02", weightKg: 82 },
      ],
      "2026-10-02"
    );
    expect(trend.get("2026-10-01")).toBe(80);
    expect(trend.get("2026-10-02")).toBeCloseTo(80.2, 5);
  });
  it("interpolates gaps so a weekly weigher's trend still moves", () => {
    const trend = trendWeightByDate(
      [
        { date: "2026-10-01", weightKg: 80 },
        { date: "2026-10-08", weightKg: 79.3 },
      ],
      "2026-10-08"
    );
    expect(trend.get("2026-10-04")!).toBeLessThan(80);
    expect(trend.get("2026-10-08")!).toBeLessThan(trend.get("2026-10-04")!);
  });
  it("averages same-day weigh-ins and ignores logs after the cut-off", () => {
    const trend = trendWeightByDate(
      [
        { date: "2026-10-01", weightKg: 79 },
        { date: "2026-10-01", weightKg: 81 },
        { date: "2026-10-05", weightKg: 60 },
      ],
      "2026-10-03"
    );
    expect(trend.get("2026-10-01")).toBe(80);
    expect(trend.get("2026-10-03")).toBe(80);
    expect(trend.has("2026-10-05")).toBe(false);
  });
});

describe("learnExpenditure", () => {
  const start = "2026-09-07"; // a Monday

  function history(days: number, kcal: number, kgPerDay: number, opts: Partial<DiaryDay> = {}) {
    const weights: WeightPoint[] = [];
    const diary: DiaryDay[] = [];
    for (let i = 0; i < days; i++) {
      const date = isoDaysAfter(start, i);
      weights.push({ date, weightKg: 70 + kgPerDay * i });
      diary.push(day(date, kcal, opts));
    }
    return { weights, diary };
  }

  it("stays on the formula without enough complete days", () => {
    const { weights } = history(28, 0, 0);
    const result = learnExpenditure({
      formulaKcal: 2200,
      weightLogs: weights,
      diaryDays: [],
      goalAdjustKcal: 0,
      checkInDate: isoDaysAfter(start, 28),
    });
    expect(result).toMatchObject({ kcal: 2200, source: "formula", learnedWeeks: 0 });
  });

  it("moves gradually towards what complete days imply", () => {
    // Steady weight on 2,600 kcal -> real burn about 2,600.
    const { weights, diary } = history(42, 2600, 0);
    const result = learnExpenditure({
      formulaKcal: 2200,
      weightLogs: weights,
      diaryDays: diary,
      goalAdjustKcal: 0,
      checkInDate: isoDaysAfter(start, 42),
    });
    expect(result.source).toBe("learned");
    expect(result.kcal).toBeGreaterThan(2200);
    expect(result.kcal).toBeLessThan(2600);
    // Capped at +150 per learned week.
    expect(result.kcal - 2200).toBeLessThanOrEqual(150 * result.learnedWeeks);
  });

  it("ignores partial days, so under-logging no longer drags the estimate down", () => {
    // Logs 1,000 kcal on 2 meal slots, weight steady: these days must not count.
    const { weights, diary } = history(42, 1000, 0, { mealSlotsLogged: 2 });
    const result = learnExpenditure({
      formulaKcal: 1980,
      weightLogs: weights,
      diaryDays: diary,
      goalAdjustKcal: -330,
      checkInDate: isoDaysAfter(start, 42),
    });
    expect(result).toMatchObject({ kcal: 1980, source: "formula", completeDaysLast14: 0 });
  });

  it("still learns from partial-looking days the member marked complete", () => {
    const { weights, diary } = history(42, 1500, 0, { mealSlotsLogged: 2, status: "complete" });
    const result = learnExpenditure({
      formulaKcal: 1980,
      weightLogs: weights,
      diaryDays: diary,
      goalAdjustKcal: 0,
      checkInDate: isoDaysAfter(start, 42),
    });
    expect(result.source).toBe("learned");
    expect(result.kcal).toBeLessThan(1980);
    expect(result.completeDaysLast14).toBe(14);
  });

  it("is deterministic", () => {
    const { weights, diary } = history(35, 2400, -0.05);
    const input = { formulaKcal: 2500, weightLogs: weights, diaryDays: diary, goalAdjustKcal: -300, checkInDate: isoDaysAfter(start, 35) };
    expect(learnExpenditure(input)).toEqual(learnExpenditure(input));
  });
});

describe("resting and formula expenditure", () => {
  it("uses Mifflin-St Jeor with height and age", () => {
    expect(restingKcal(60, "Female", "1996-01-01", "2026-10-25", 165)).toBe(1320);
  });
  it("falls back to a bodyweight estimate without height", () => {
    expect(restingKcal(60, "Female", "1996-01-01", "2026-10-25", null)).toBe(Math.round(60 * 22 * 0.94));
  });
  it("averages maintenance over the week's fuel days", () => {
    const allStandard = formulaExpenditureKcal(60, "Female", "1996-01-01", "2026-10-25", 165, Array(7).fill("standard"));
    expect(allStandard).toBe(1980);
    const mixed = formulaExpenditureKcal(60, "Female", "1996-01-01", "2026-10-25", 165, [
      "standard", "reduced", "standard", "reduced", "standard", "reduced", "reduced",
    ]);
    expect(mixed).toBeLessThan(allStandard);
  });
});

describe("activityExpenditureKcal", () => {
  it("multiplies resting burn by the standard factor", () => {
    expect(activityExpenditureKcal(1320, "sedentary")).toBe(1584);
    expect(activityExpenditureKcal(1320, "light")).toBe(1815);
    expect(activityExpenditureKcal(1320, "moderate")).toBe(2046);
    expect(activityExpenditureKcal(1320, "very")).toBe(2277);
  });
});

describe("pace", () => {
  it("defaults by goal", () => {
    expect(defaultPaceForGoal("Weight Loss")).toBe(-0.5);
    expect(defaultPaceForGoal("Build Muscle")).toBe(0.25);
    expect(defaultPaceForGoal("General Health")).toBe(0);
  });
  it("clamps to the offered range", () => {
    expect(clampPace(-2)).toBe(-1);
    expect(clampPace(1)).toBe(0.5);
  });
  it("turns a weekly % into kcal per day", () => {
    expect(paceAdjustKcal(-0.5, 60)).toBe(-330);
    expect(paceAdjustKcal(0.25, 80)).toBe(220);
  });
});

describe("minimum and weekly budget", () => {
  it("takes the highest of the sex floor, resting burn and 75% of expenditure", () => {
    expect(minimumDailyAverageKcal("Female", 1320, 1980)).toBe(1485);
    expect(minimumDailyAverageKcal("Female", 1100, 1400)).toBe(1200);
    expect(minimumDailyAverageKcal("Male", 1400, 1800)).toBe(1500);
  });
  it("leaves a safe target alone", () => {
    expect(weeklyBudget(1980, -330, 1485)).toEqual({
      weekBudgetKcal: 11550,
      dailyAverageKcal: 1650,
      appliedAdjustKcal: -330,
      minimumApplied: false,
      paceLimited: false,
    });
  });
  it("slows the pace when the minimum applies", () => {
    expect(weeklyBudget(1980, -660, 1485)).toMatchObject({
      dailyAverageKcal: 1485,
      appliedAdjustKcal: -495,
      minimumApplied: true,
      paceLimited: true,
    });
  });
});

describe("distributeWeek", () => {
  const plan: FuelDay[] = ["standard", "reduced", "standard", "reduced", "standard", "reduced", "reduced"];

  it("gives the same number every day when even", () => {
    expect(distributeWeek({ weekBudgetKcal: 11550, distribution: "even", fuelDays: plan, dayFloorKcal: 1200 })).toEqual(
      Array(7).fill(1650)
    );
  });

  it("follows training but keeps the weekly total", () => {
    const days = distributeWeek({ weekBudgetKcal: 11550, distribution: "training", fuelDays: plan, dayFloorKcal: 1200 });
    expect(sum(days)).toBe(11550);
    expect(days[0]).toBe(1750);
    expect(days[1]).toBe(1575);
  });

  it("caps every day within 20% of the average", () => {
    const extreme: FuelDay[] = ["match", "reduced", "reduced", "reduced", "reduced", "reduced", "reduced"];
    const days = distributeWeek({ weekBudgetKcal: 14000, distribution: "training", fuelDays: extreme, dayFloorKcal: 1200 });
    expect(sum(days)).toBe(14000);
    for (const k of days) {
      expect(k).toBeGreaterThanOrEqual(2000 * 0.8 - 1);
      expect(k).toBeLessThanOrEqual(2000 * 1.2 + 1);
    }
  });

  it("moves luteal calories within the week", () => {
    const luteal = [false, false, false, false, true, true, true];
    const days = distributeWeek({ weekBudgetKcal: 14000, distribution: "even", fuelDays: plan, lutealDays: luteal, dayFloorKcal: 1200 });
    expect(sum(days)).toBe(14000);
    expect(days[4]).toBe(2120);
    expect(days[0]).toBe(1910);
  });

  it("never drops a day below the floor", () => {
    const days = distributeWeek({ weekBudgetKcal: 8800, distribution: "training", fuelDays: plan, dayFloorKcal: 1200 });
    expect(Math.min(...days)).toBeGreaterThanOrEqual(1200);
    expect(sum(days)).toBe(8800);
  });
});

describe("resolveDistribution", () => {
  const base = { coachDistribution: null, coachLocked: false, memberDistribution: null, isMembershipTier: false } as const;

  it("defaults by tier", () => {
    expect(resolveDistribution(base)).toEqual({ distribution: "even", source: "default" });
    expect(resolveDistribution({ ...base, isMembershipTier: true })).toEqual({ distribution: "training", source: "default" });
  });
  it("lets the member choose over a coach default", () => {
    expect(resolveDistribution({ ...base, coachDistribution: "training", memberDistribution: "even" })).toEqual({
      distribution: "even",
      source: "member",
    });
  });
  it("uses the coach default when the member hasn't chosen", () => {
    expect(resolveDistribution({ ...base, coachDistribution: "training" })).toEqual({ distribution: "training", source: "coach" });
  });
  it("a coach lock wins", () => {
    expect(
      resolveDistribution({ ...base, coachDistribution: "training", coachLocked: true, memberDistribution: "even" })
    ).toEqual({ distribution: "training", source: "coach-locked" });
  });
});

describe("worked example from the plan (tester-like profile)", () => {
  it("female 60 kg, 165 cm, 30, moderate loss, three training days", () => {
    const plan: FuelDay[] = ["standard", "reduced", "standard", "reduced", "standard", "reduced", "reduced"];
    // Partial days (2 slots, about 1,300 kcal) are ignored, so she stays on the formula.
    const formula = formulaExpenditureKcal(60, "Female", "1996-01-01", "2026-10-26", 165, Array(7).fill("standard"));
    expect(formula).toBe(1980);
    const adjust = paceAdjustKcal(defaultPaceForGoal("Weight Loss"), 60);
    const minimum = minimumDailyAverageKcal("Female", restingKcal(60, "Female", "1996-01-01", "2026-10-26", 165), formula);
    const budget = weeklyBudget(formula, adjust, minimum);
    expect(budget.dailyAverageKcal).toBe(1650);
    expect(budget.paceLimited).toBe(false);

    const even = distributeWeek({ weekBudgetKcal: budget.weekBudgetKcal, distribution: "even", fuelDays: plan, dayFloorKcal: 1200 });
    const training = distributeWeek({ weekBudgetKcal: budget.weekBudgetKcal, distribution: "training", fuelDays: plan, dayFloorKcal: 1200 });
    expect(even[0]).toBe(1650);
    expect([training[0], training[1]]).toEqual([1750, 1575]);
  });
});
