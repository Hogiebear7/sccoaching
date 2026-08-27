import { describe, expect, it } from "vitest";

import { computeGoalTimeline, goalTimelineAdjustKcal } from "@/lib/body-composition-goal";

describe("computeGoalTimeline", () => {
  it("returns a realistic required rate for a modest weight-loss date", () => {
    // 80kg -> 76kg over 8 weeks (56 days) = -4kg / 56 days * 7 = -0.5 kg/week,
    // well within the 1%/week (0.8kg/week) safe bound.
    const result = computeGoalTimeline({
      currentValue: 80,
      goalValue: 76,
      targetDateISO: "2026-03-01",
      asOfDateISO: "2026-01-05",
      history: [],
    });
    expect(result.direction).toBe("lose");
    expect(result.daysToTarget).toBe(55);
    expect(result.requiredWeeklyRate).toBeCloseTo(-0.509, 2);
    expect(result.isAggressive).toBe(false);
    expect(result.clampedWeeklyRate).toBeCloseTo(result.requiredWeeklyRate!, 5);
  });

  it("clamps and flags an unrealistically aggressive weight-loss date", () => {
    // 80kg -> 70kg in 2 weeks -- far beyond any safe rate.
    const result = computeGoalTimeline({
      currentValue: 80,
      goalValue: 70,
      targetDateISO: "2026-01-19",
      asOfDateISO: "2026-01-05",
      history: [],
    });
    expect(result.isAggressive).toBe(true);
    // Clamp is -1%/week of current value = -0.8 kg/week.
    expect(result.clampedWeeklyRate).toBeCloseTo(-0.8, 5);
    expect(result.clampedWeeklyRate!).toBeGreaterThan(result.requiredWeeklyRate!);
  });

  it("clamps a gain goal to the tighter lean-gain bound", () => {
    // 70kg -> 74kg in 4 weeks = 1kg/week required, way past the 0.25%/week cap.
    const result = computeGoalTimeline({
      currentValue: 70,
      goalValue: 74,
      targetDateISO: "2026-02-02",
      asOfDateISO: "2026-01-05",
      history: [],
    });
    expect(result.direction).toBe("gain");
    expect(result.isAggressive).toBe(true);
    expect(result.clampedWeeklyRate).toBeCloseTo(70 * 0.0025, 5);
  });

  it("returns nulls for rate fields when no target date is set", () => {
    const result = computeGoalTimeline({
      currentValue: 80,
      goalValue: 76,
      targetDateISO: null,
      asOfDateISO: "2026-01-05",
      history: [],
    });
    expect(result.daysToTarget).toBeNull();
    expect(result.requiredWeeklyRate).toBeNull();
    expect(result.clampedWeeklyRate).toBeNull();
    expect(result.isAggressive).toBe(false);
  });

  it("treats a goal within 0.05 of current value as 'maintain' with no rate math", () => {
    const result = computeGoalTimeline({
      currentValue: 80,
      goalValue: 80.02,
      targetDateISO: "2026-03-01",
      asOfDateISO: "2026-01-05",
      history: [],
    });
    expect(result.direction).toBe("maintain");
    expect(result.daysToTarget).toBeNull();
    expect(result.requiredWeeklyRate).toBeNull();
  });

  it("projects a date at the current logged trend when it's moving toward the goal", () => {
    const history = [
      { date: "2026-01-01", weightKg: 82 },
      { date: "2026-01-08", weightKg: 81 },
      { date: "2026-01-15", weightKg: 80 },
    ];
    const result = computeGoalTimeline({
      currentValue: 80,
      goalValue: 76,
      targetDateISO: null,
      asOfDateISO: "2026-01-15",
      history,
    });
    // Losing ~1kg/week -> ~4 weeks (28 days) to lose 4kg.
    expect(result.projectedDateAtCurrentTrend).toBe("2026-02-12");
  });

  it("returns no projection when the logged trend is moving away from the goal", () => {
    const history = [
      { date: "2026-01-01", weightKg: 78 },
      { date: "2026-01-08", weightKg: 79 },
      { date: "2026-01-15", weightKg: 80 },
    ];
    const result = computeGoalTimeline({
      currentValue: 80,
      goalValue: 76, // wants to lose, but trend is gaining
      targetDateISO: null,
      asOfDateISO: "2026-01-15",
      history,
    });
    expect(result.projectedDateAtCurrentTrend).toBeNull();
  });
});

describe("goalTimelineAdjustKcal", () => {
  it("returns 0 for a null clamped rate", () => {
    expect(goalTimelineAdjustKcal(null)).toBe(0);
  });

  it("converts a weekly kg rate into a daily kcal adjustment", () => {
    // -0.5 kg/week * 7700 kcal/kg / 7 days = -550 kcal/day.
    expect(goalTimelineAdjustKcal(-0.5)).toBe(-550);
  });
});
