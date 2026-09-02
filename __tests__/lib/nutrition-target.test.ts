import { describe, expect, it } from "vitest";

import {
  applyGoalAdjustment,
  coldStartMaintenanceKcal,
  complianceAdjustmentKcal,
  computeDailyTarget,
  computeWeightTrend,
  cyclePhaseAdjustmentKcal,
  estimateAdaptiveTdee,
  exertionFromWeeklySessions,
  macrosForCalorieTarget,
  validateMemberTargetOverride,
  type IntakePoint,
  type WeightPoint,
} from "@/lib/nutrition-target";
import type { WeeklyTrainingSession } from "@/lib/profile-schema";

function isoDaysAfter(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("computeWeightTrend", () => {
  it("fits a losing trend from daily logs", () => {
    const start = "2026-01-01";
    const points: WeightPoint[] = Array.from({ length: 14 }, (_, i) => ({
      date: isoDaysAfter(start, i),
      weightKg: 80 - i * 0.1, // -0.1 kg/day, -1.4 kg over 13 days
    }));
    const trend = computeWeightTrend(points);
    expect(trend).not.toBeNull();
    expect(trend!.slopeKgPerDay).toBeCloseTo(-0.1, 5);
    expect(trend!.points).toBe(14);
  });

  it("averages same-date duplicate weigh-ins instead of double-counting", () => {
    const points: WeightPoint[] = [
      { date: "2026-01-01", weightKg: 80 },
      { date: "2026-01-01", weightKg: 80.4 },
      { date: "2026-01-08", weightKg: 79 },
    ];
    const trend = computeWeightTrend(points);
    expect(trend!.points).toBe(2);
  });

  it("returns null with fewer than two distinct days", () => {
    expect(computeWeightTrend([{ date: "2026-01-01", weightKg: 80 }])).toBeNull();
    expect(
      computeWeightTrend([
        { date: "2026-01-01", weightKg: 80 },
        { date: "2026-01-01", weightKg: 80.2 },
      ])
    ).toBeNull();
  });
});

describe("estimateAdaptiveTdee", () => {
  const start = "2026-01-01";
  const asOf = isoDaysAfter(start, 27);

  it("returns null without enough weight or diary history", () => {
    expect(estimateAdaptiveTdee([], [], asOf)).toBeNull();

    const fewWeights: WeightPoint[] = Array.from({ length: 5 }, (_, i) => ({
      date: isoDaysAfter(start, i),
      weightKg: 80,
    }));
    const plentyIntake: IntakePoint[] = Array.from({ length: 20 }, (_, i) => ({
      date: isoDaysAfter(start, i),
      calories: 2500,
    }));
    expect(estimateAdaptiveTdee(fewWeights, plentyIntake, asOf)).toBeNull();
  });

  it("back-calculates TDEE from real weight loss vs logged intake", () => {
    // Losing 0.5 kg/week over 28 days on 2200 kcal/day average intake:
    // change = -2 kg over 28 days -> TDEE = 2200 - (-2 * 7700 / 28) = 2200 + 550 = 2750
    const weightLogs: WeightPoint[] = Array.from({ length: 28 }, (_, i) => ({
      date: isoDaysAfter(start, i),
      weightKg: 82 - i * (2 / 27),
    }));
    const intake: IntakePoint[] = Array.from({ length: 28 }, (_, i) => ({
      date: isoDaysAfter(start, i),
      calories: 2200,
    }));

    const estimate = estimateAdaptiveTdee(weightLogs, intake, asOf);
    expect(estimate).not.toBeNull();
    expect(estimate!.confidence).toBe("adaptive");
    expect(estimate!.kcal).toBeGreaterThan(2600);
    expect(estimate!.kcal).toBeLessThan(2900);
  });

  it("rejects an implausible result instead of returning nonsense", () => {
    // A wild, noisy "weight loss" of 20 kg in 28 days on high intake would
    // back-calculate an absurd TDEE — must be discarded, not surfaced.
    const weightLogs: WeightPoint[] = Array.from({ length: 28 }, (_, i) => ({
      date: isoDaysAfter(start, i),
      weightKg: 100 - i * (20 / 27),
    }));
    const intake: IntakePoint[] = Array.from({ length: 28 }, (_, i) => ({
      date: isoDaysAfter(start, i),
      calories: 3000,
    }));
    expect(estimateAdaptiveTdee(weightLogs, intake, asOf)).toBeNull();
  });
});

describe("coldStartMaintenanceKcal", () => {
  it("scales with bodyweight and the day's fuel band", () => {
    const reduced = coldStartMaintenanceKcal(80, "reduced", "Male", null, "2026-01-01");
    const match = coldStartMaintenanceKcal(80, "match", "Male", null, "2026-01-01");
    expect(match).toBeGreaterThan(reduced);
    expect(reduced).toBe(80 * 24);
  });

  it("nudges gently for gender and older age without ever inventing a number for missing data gracefully", () => {
    const male = coldStartMaintenanceKcal(80, "standard", "Male", null, "2026-01-01");
    const female = coldStartMaintenanceKcal(80, "standard", "Female", null, "2026-01-01");
    expect(female).toBeLessThan(male);

    const young = coldStartMaintenanceKcal(80, "standard", "Male", "1996-01-01", "2026-01-01"); // age 30
    const older = coldStartMaintenanceKcal(80, "standard", "Male", "1966-01-01", "2026-01-01"); // age 60
    expect(older).toBeLessThan(young);
  });
});

describe("coldStartMaintenanceKcal — height-aware BMR path", () => {
  it("uses the bodyweight heuristic when height is missing", () => {
    const kcal = coldStartMaintenanceKcal(80, "standard", "Male", "1996-01-01", "2026-01-01");
    expect(kcal).toBe(80 * 27); // BAND_KCAL_PER_KG.standard, no gender/age adjustment at age 30
  });

  it("switches to a real BMR equation once height and date of birth are both present", () => {
    const heuristic = coldStartMaintenanceKcal(80, "standard", "Male", "1996-01-01", "2026-01-01");
    const bmrBased = coldStartMaintenanceKcal(80, "standard", "Male", "1996-01-01", "2026-01-01", 180);
    // Different formula entirely — shouldn't coincidentally match the heuristic.
    expect(bmrBased).not.toBe(heuristic);
    // Sanity: a healthy adult male's maintenance should land in a plausible range.
    expect(bmrBased).toBeGreaterThan(1800);
    expect(bmrBased).toBeLessThan(4000);
  });

  it("falls back to the heuristic when height is present but date of birth isn't (BMR needs both)", () => {
    const withHeightNoDob = coldStartMaintenanceKcal(80, "standard", "Male", null, "2026-01-01", 180);
    const heuristic = coldStartMaintenanceKcal(80, "standard", "Male", null, "2026-01-01");
    expect(withHeightNoDob).toBe(heuristic);
  });

  it("a taller member at the same weight/age gets a higher BMR-based maintenance number", () => {
    const shorter = coldStartMaintenanceKcal(70, "standard", "Female", "1996-01-01", "2026-01-01", 160);
    const taller = coldStartMaintenanceKcal(70, "standard", "Female", "1996-01-01", "2026-01-01", 180);
    expect(taller).toBeGreaterThan(shorter);
  });
});

describe("cyclePhaseAdjustmentKcal", () => {
  it("adds a bump only during the luteal phase", () => {
    expect(cyclePhaseAdjustmentKcal("Luteal")).toBeGreaterThan(0);
    expect(cyclePhaseAdjustmentKcal("Menstrual")).toBe(0);
    expect(cyclePhaseAdjustmentKcal("Follicular")).toBe(0);
    expect(cyclePhaseAdjustmentKcal("Ovulatory")).toBe(0);
    expect(cyclePhaseAdjustmentKcal("Unknown")).toBe(0);
    expect(cyclePhaseAdjustmentKcal(null)).toBe(0);
  });
});

describe("exertionFromWeeklySessions", () => {
  const sessions: WeeklyTrainingSession[] = [
    { id: "1", dayOfWeek: 1, label: "Gym", activityType: "gym", timeOfDay: "morning", intensity: "moderate", notes: null, recurring: true, weekOf: null, sourceBookingId: null },
    { id: "2", dayOfWeek: 3, label: "Football", activityType: "sport", timeOfDay: "evening", intensity: "heavy", notes: null, recurring: true, weekOf: null, sourceBookingId: null },
    { id: "3", dayOfWeek: 0, label: "Rest", activityType: "rest", timeOfDay: null, intensity: null, notes: null, recurring: true, weekOf: null, sourceBookingId: null },
  ];

  it("maps a moderate gym day to medium", () => {
    expect(exertionFromWeeklySessions(sessions, 1)).toBe("medium");
  });

  it("maps heavy sport to match-like demand", () => {
    expect(exertionFromWeeklySessions(sessions, 3)).toBe("match");
  });

  it("treats a day with no sessions, or only rest, as low", () => {
    expect(exertionFromWeeklySessions(sessions, 2)).toBe("low");
    expect(exertionFromWeeklySessions(sessions, 0)).toBe("low");
  });

  it("takes the busiest session when a day has more than one", () => {
    const busy: WeeklyTrainingSession[] = [
      { id: "a", dayOfWeek: 5, label: "Easy jog", activityType: "cardio", timeOfDay: "morning", intensity: "light", notes: null, recurring: true, weekOf: null, sourceBookingId: null },
      { id: "b", dayOfWeek: 5, label: "Heavy lift", activityType: "gym", timeOfDay: "evening", intensity: "heavy", notes: null, recurring: true, weekOf: null, sourceBookingId: null },
    ];
    expect(exertionFromWeeklySessions(busy, 5)).toBe("high");
  });
});

describe("complianceAdjustmentKcal", () => {
  it("nudges today down by a damped fraction after eating over target", () => {
    // 500 over -> -0.3*500 = -150
    expect(complianceAdjustmentKcal(2500, 3000)).toBe(-150);
  });

  it("nudges today up after eating under target", () => {
    expect(complianceAdjustmentKcal(2500, 2000)).toBe(150);
  });

  it("caps the nudge so one extreme day can't shock today's target", () => {
    expect(complianceAdjustmentKcal(2000, 4000)).toBe(-250);
    expect(complianceAdjustmentKcal(2000, 200)).toBe(250);
  });

  it("is a no-op with no target or no logged intake", () => {
    expect(complianceAdjustmentKcal(null, 2000)).toBe(0);
    expect(complianceAdjustmentKcal(2000, null)).toBe(0);
    expect(complianceAdjustmentKcal(2000, 0)).toBe(0);
  });
});

describe("applyGoalAdjustment", () => {
  it("applies a moderate deficit/surplus by goal", () => {
    expect(applyGoalAdjustment(2500, "maintain", 80)).toBe(2500);
    expect(applyGoalAdjustment(2500, "lose", 80)).toBe(2000);
    expect(applyGoalAdjustment(2500, "gain", 80)).toBe(2750);
  });

  it("never drops below the bodyweight safety floor even on an aggressive deficit", () => {
    // 18 kcal/kg floor at 50 kg = 900; 0.8x of a low base would undercut it
    expect(applyGoalAdjustment(1000, "lose", 50)).toBe(900);
  });
});

describe("macrosForCalorieTarget", () => {
  it("sums exactly to the calorie target", () => {
    const band = { day: "standard" as const, label: "Standard fuel day", carbGkg: 5, proteinGkg: 1.6, fatGkg: 0.8, emphasis: "" };
    const macros = macrosForCalorieTarget(2800, 80, band);
    const total = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
    expect(Math.abs(total - 2800)).toBeLessThanOrEqual(4); // rounding only
  });

  it("relaxes fat toward its floor rather than going carb-negative at a tight deficit", () => {
    const band = { day: "reduced" as const, label: "Reduced fuel day", carbGkg: 4, proteinGkg: 1.6, fatGkg: 0.9, emphasis: "" };
    const macros = macrosForCalorieTarget(1400, 90, band); // aggressive deficit on a heavier body
    expect(macros.carbsG).toBeGreaterThanOrEqual(50);
    expect(macros.fatG).toBeGreaterThan(0);
  });
});

describe("computeDailyTarget", () => {
  it("uses the adaptive TDEE when supplied instead of the cold-start estimate", () => {
    const target = computeDailyTarget({
      bodyWeightKg: 80,
      gender: "Male",
      dateOfBirth: null,
      goalBias: "maintain",
      tdee: { kcal: 2900, confidence: "adaptive", weightChangeKg: 0, avgIntakeKcal: 2900, windowDays: 28 },
      load: 2.0, // standard fuel day
      date: "2026-01-15",
    });
    expect(target.source).toBe("adaptive");
    expect(target.calories).toBe(2900);
  });

  it("falls back to the cold-start estimate with no TDEE yet", () => {
    const target = computeDailyTarget({
      bodyWeightKg: 80,
      gender: "Male",
      dateOfBirth: null,
      goalBias: "maintain",
      tdee: null,
      load: 2.0,
      date: "2026-01-15",
    });
    expect(target.source).toBe("estimated");
    expect(target.calories).toBe(80 * 27); // standard band multiplier
  });

  it("folds in the yesterday-compliance nudge", () => {
    const withoutNudge = computeDailyTarget({
      bodyWeightKg: 80,
      gender: "Male",
      dateOfBirth: null,
      goalBias: "maintain",
      tdee: { kcal: 2800, confidence: "adaptive", weightChangeKg: 0, avgIntakeKcal: 2800, windowDays: 28 },
      load: 2.0,
      date: "2026-01-15",
    });
    const withNudge = computeDailyTarget({
      bodyWeightKg: 80,
      gender: "Male",
      dateOfBirth: null,
      goalBias: "maintain",
      tdee: { kcal: 2800, confidence: "adaptive", weightChangeKg: 0, avgIntakeKcal: 2800, windowDays: 28 },
      load: 2.0,
      date: "2026-01-15",
      yesterdayComplianceKcal: -150,
    });
    expect(withNudge.calories).toBe(withoutNudge.calories - 150);
  });

  it("uses the height-aware BMR path when heightCm is supplied on a cold-start member", () => {
    const withoutHeight = computeDailyTarget({
      bodyWeightKg: 80,
      gender: "Male",
      dateOfBirth: "1996-01-01",
      goalBias: "maintain",
      tdee: null,
      load: 2.0,
      date: "2026-01-15",
    });
    const withHeight = computeDailyTarget({
      bodyWeightKg: 80,
      gender: "Male",
      dateOfBirth: "1996-01-01",
      heightCm: 180,
      goalBias: "maintain",
      tdee: null,
      load: 2.0,
      date: "2026-01-15",
    });
    expect(withHeight.calories).not.toBe(withoutHeight.calories);
  });

  it("adds the luteal-phase bump on top of an otherwise-identical target", () => {
    const noPhase = computeDailyTarget({
      bodyWeightKg: 65,
      gender: "Female",
      dateOfBirth: "1996-01-01",
      goalBias: "maintain",
      tdee: { kcal: 2100, confidence: "adaptive", weightChangeKg: 0, avgIntakeKcal: 2100, windowDays: 28 },
      load: 2.0,
      date: "2026-01-15",
    });
    const luteal = computeDailyTarget({
      bodyWeightKg: 65,
      gender: "Female",
      dateOfBirth: "1996-01-01",
      goalBias: "maintain",
      tdee: { kcal: 2100, confidence: "adaptive", weightChangeKg: 0, avgIntakeKcal: 2100, windowDays: 28 },
      load: 2.0,
      date: "2026-01-15",
      cyclePhase: "Luteal",
    });
    expect(luteal.calories).toBeGreaterThan(noPhase.calories);
  });

  // Worked examples per the launch plan's verification requirement: the
  // SAFETY_FLOOR_KCAL_PER_KG floor (18 kcal/kg) must still bind after every
  // new adjustment (height-aware BMR, cycle-phase bump), not just the
  // pre-existing goal/compliance ones.
  describe("SAFETY_FLOOR_KCAL_PER_KG still binds after the new adjustments", () => {
    it("a lighter member on an aggressive cut with height set never drops below the floor", () => {
      const target = computeDailyTarget({
        bodyWeightKg: 50,
        gender: "Female",
        dateOfBirth: "2000-01-01",
        heightCm: 150, // small frame -> a low BMR that an aggressive cut could undercut
        goalBias: "lose",
        tdee: null,
        load: 0.5, // reduced fuel day, minimal load
        date: "2026-01-15",
      });
      expect(target.calories).toBeGreaterThanOrEqual(50 * 18);
    });

    it("floor still binds even with a luteal bump layered on an aggressive cut", () => {
      const target = computeDailyTarget({
        bodyWeightKg: 50,
        gender: "Female",
        dateOfBirth: "2000-01-01",
        heightCm: 150,
        goalBias: "lose",
        tdee: null,
        load: 0.5,
        date: "2026-01-15",
        cyclePhase: "Luteal",
        yesterdayComplianceKcal: -250, // worst-case: also nudged down by yesterday's overshoot
      });
      expect(target.calories).toBeGreaterThanOrEqual(50 * 18);
    });

    it("floor still binds when a goal-timeline adjustment is aggressively negative", () => {
      const target = computeDailyTarget({
        bodyWeightKg: 50,
        gender: "Female",
        dateOfBirth: "2000-01-01",
        heightCm: 150,
        goalBias: "lose",
        tdee: null,
        load: 0.5,
        date: "2026-01-15",
        goalTimelineAdjustKcal: -900, // an unrealistically steep clamp-bypassing value
        yesterdayComplianceKcal: -250,
      });
      expect(target.calories).toBeGreaterThanOrEqual(50 * 18);
      expect(target.goalTimelineAdjustKcal).toBe(-900);
    });
  });
});

describe("computeDailyTarget — goal timeline", () => {
  it("uses goalTimelineAdjustKcal instead of the flat goalBias multiplier when set", () => {
    const withTimeline = computeDailyTarget({
      bodyWeightKg: 80,
      gender: "Male",
      dateOfBirth: "1995-01-01",
      goalBias: "lose",
      tdee: { kcal: 2800, confidence: "adaptive", weightChangeKg: 0, avgIntakeKcal: 2800, windowDays: 28 },
      load: 2.0,
      date: "2026-01-15",
      goalTimelineAdjustKcal: -300,
    });
    // 2800 base - 300 timeline adjustment = 2500 (no compliance/cycle nudge here).
    expect(withTimeline.calories).toBe(2500);
    expect(withTimeline.goalTimelineAdjustKcal).toBe(-300);
  });

  it("falls back to the flat goalBias multiplier when goalTimelineAdjustKcal is omitted", () => {
    const withoutTimeline = computeDailyTarget({
      bodyWeightKg: 80,
      gender: "Male",
      dateOfBirth: "1995-01-01",
      goalBias: "lose",
      tdee: { kcal: 2800, confidence: "adaptive", weightChangeKg: 0, avgIntakeKcal: 2800, windowDays: 28 },
      load: 2.0,
      date: "2026-01-15",
    });
    expect(withoutTimeline.goalTimelineAdjustKcal).toBeNull();
    // 2800 * 0.8 (lose bias) = 2240.
    expect(withoutTimeline.calories).toBe(2240);
  });
});

describe("validateMemberTargetOverride", () => {
  const bodyWeightKg = 70;

  it("accepts a reasonable target whose macros add up", () => {
    const result = validateMemberTargetOverride(bodyWeightKg, {
      calories: 2200,
      proteinG: 160,
      carbsG: 220,
      fatG: 70,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a target below the safety floor", () => {
    const result = validateMemberTargetOverride(bodyWeightKg, {
      calories: 900, // well under 70 * 18 = 1260
      proteinG: 100,
      carbsG: 80,
      fatG: 20,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a target above the member-override ceiling", () => {
    const result = validateMemberTargetOverride(bodyWeightKg, {
      calories: 5000, // well over 70 * 45 = 3150
      proteinG: 300,
      carbsG: 500,
      fatG: 150,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects macros that don't add up to the stated calorie total", () => {
    const result = validateMemberTargetOverride(bodyWeightKg, {
      calories: 2200,
      proteinG: 50,
      carbsG: 50,
      fatG: 20, // 50*4 + 50*4 + 20*9 = 580, nowhere near 2200
    });
    expect(result.ok).toBe(false);
  });

  it("rejects negative or non-finite inputs", () => {
    const result = validateMemberTargetOverride(bodyWeightKg, {
      calories: 2200,
      proteinG: -10,
      carbsG: 220,
      fatG: 70,
    });
    expect(result.ok).toBe(false);
  });
});
