// Pregnancy, the 12 weeks after the birth and breastfeeding: stage rules,
// the burn-learning pause, and the resolver end to end.
import { describe, expect, it } from "vitest";

import { learnExpenditure, type DiaryDay, type WeightPoint } from "@/lib/nutrition-target";
import { learningPauseFor, nutritionStageFor, stageAdjustment } from "@/lib/pregnancy-nutrition";
import type { PregnancyStatusRecord } from "@/lib/profile-schema";

function plus(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function record(over: Partial<PregnancyStatusRecord>): PregnancyStatusRecord {
  return {
    userId: "u",
    isPregnant: true,
    dueDate: "2027-05-20",
    shareWithCoach: false,
    createdAt: "x",
    updatedAt: "x",
    ...over,
  };
}

describe("nutritionStageFor", () => {
  const due = "2027-05-20"; // pregnancy start 2026-08-13
  it("follows the trimesters", () => {
    expect(nutritionStageFor(record({}), "2026-10-26")).toMatchObject({ kind: "pregnant", trimester: 1, weeksPregnant: 10 });
    expect(nutritionStageFor(record({}), plus("2026-08-13", 20 * 7))).toMatchObject({ kind: "pregnant", trimester: 2 });
    expect(nutritionStageFor(record({}), plus("2026-08-13", 30 * 7))).toMatchObject({ kind: "pregnant", trimester: 3 });
  });

  it("covers 12 weeks after the birth, then only breastfeeding", () => {
    const born = record({ birthDate: "2027-05-14", breastfeeding: true });
    expect(nutritionStageFor(born, "2027-06-01")).toMatchObject({ kind: "postpartum", breastfeeding: true });
    expect(nutritionStageFor(born, "2027-09-01")).toMatchObject({ kind: "breastfeeding" });
    expect(nutritionStageFor({ ...born, breastfeeding: false }, "2027-09-01")).toBeNull();
    expect(nutritionStageFor(record({}), plus(due, 7))).toMatchObject({ kind: "postpartum", breastfeeding: false });
  });

  it("is nothing without a pregnancy", () => {
    expect(nutritionStageFor(null, "2026-10-26")).toBeNull();
    expect(nutritionStageFor(record({ isPregnant: false, dueDate: null }), "2026-10-26")).toBeNull();
  });
});

describe("stageAdjustment", () => {
  it("adds the HSE trimester extras and holds pregnancy at maintenance", () => {
    expect(stageAdjustment({ kind: "pregnant", trimester: 1, weeksPregnant: 8 }, 60)).toMatchObject({ extraKcal: 0, minAdjustKcal: 0, maxAdjustKcal: 0 });
    expect(stageAdjustment({ kind: "pregnant", trimester: 2, weeksPregnant: 20 }, 60).extraKcal).toBe(250);
    expect(stageAdjustment({ kind: "pregnant", trimester: 3, weeksPregnant: 30 }, 60).extraKcal).toBe(500);
  });

  it("adds +500 while breastfeeding and keeps later loss gentle", () => {
    expect(stageAdjustment({ kind: "postpartum", weeksSinceBirth: 3, breastfeeding: true }, 60)).toMatchObject({ extraKcal: 500, maxAdjustKcal: 0 });
    expect(stageAdjustment({ kind: "postpartum", weeksSinceBirth: 3, breastfeeding: false }, 60).extraKcal).toBe(0);
    const later = stageAdjustment({ kind: "breastfeeding", weeksSinceBirth: 20 }, 60);
    expect(later.extraKcal).toBe(500);
    expect(later.maxAdjustKcal).toBeNull();
    expect(later.minAdjustKcal).toBe(-330); // 0.5% of 60 kg a week
    expect(later.line).toMatch(/Let the app know when you stop breastfeeding/);
  });
});

describe("learningPauseFor", () => {
  it("runs from the start of the pregnancy until 12 weeks after the birth", () => {
    expect(learningPauseFor(record({}), "2026-10-26")).toEqual({ from: "2026-08-13", to: null });
    const born = record({ birthDate: "2027-05-14", breastfeeding: false });
    expect(learningPauseFor(born, "2027-06-01")).toEqual({ from: "2026-08-13", to: null });
    expect(learningPauseFor(born, "2027-09-01")).toEqual({ from: "2026-08-13", to: "2027-08-06" });
  });

  it("stays open while breastfeeding and closes when it stopped", () => {
    expect(learningPauseFor(record({ birthDate: "2027-05-14", breastfeeding: true }), "2027-12-01")).toEqual({ from: "2026-08-13", to: null });
    const stopped = record({ birthDate: "2027-05-14", breastfeeding: false, breastfeedingEndedOn: "2027-11-01" });
    expect(learningPauseFor(stopped, "2027-12-01")).toEqual({ from: "2026-08-13", to: "2027-11-01" });
  });
});

describe("learnExpenditure with a pause", () => {
  const start = "2026-09-07";
  const weights: WeightPoint[] = [];
  const diary: DiaryDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = plus(start, i);
    // Gaining 0.1 kg a day on 2,500 kcal: reads as a lower burn unless paused.
    weights.push({ date, weightKg: 60 + 0.1 * i });
    diary.push({ date, calories: 2500, mealSlotsLogged: 4, status: "complete" });
  }
  const base = { formulaKcal: 2200, weightLogs: weights, diaryDays: diary, goalAdjustKcal: 0, checkInDate: plus(start, 42) };

  it("does not learn from paused weeks", () => {
    expect(learnExpenditure(base).source).toBe("learned");
    expect(learnExpenditure({ ...base, pause: { from: start, to: null } })).toMatchObject({ kcal: 2200, source: "formula" });
  });
});
