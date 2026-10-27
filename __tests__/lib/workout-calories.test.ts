// Extra calories for training logged beyond the plan.
import { describe, expect, it } from "vitest";

import { loggedSessionKcal, workoutExtraForDay, workoutExtraLine } from "@/lib/workout-calories";

const planned = (mins: number | null, intensity: "light" | "moderate" | "heavy" | null = "moderate") =>
  ({ id: "p", dayOfWeek: 1, label: "Gym", activityType: "gym", timeOfDay: null, intensity, estimatedDurationMins: mins, notes: null, recurring: true, weekOf: null, sourceBookingId: null, sourceProgramId: null }) as never;

describe("loggedSessionKcal", () => {
  it("counts half of a watch's number, capped", () => {
    expect(loggedSessionKcal({ durationMins: 45, sessionRpe: 7, wearableCalories: 360 }, 77)).toEqual({ kcal: 180, watchKcal: 360 });
    expect(loggedSessionKcal({ durationMins: 120, sessionRpe: 9, wearableCalories: 2000 }, 77).kcal).toBe(600);
  });

  it("estimates from length and effort without a watch", () => {
    // 30 min stair climber at RPE 6: 4 net METs x 77 kg x 0.5 h = 154.
    expect(loggedSessionKcal({ durationMins: 30, sessionRpe: 6, wearableCalories: null }, 77)).toEqual({ kcal: 154, watchKcal: null });
    expect(loggedSessionKcal({ durationMins: 60, sessionRpe: 3, wearableCalories: null }, 77).kcal).toBe(193);
  });
});

describe("workoutExtraForDay", () => {
  const session = { durationMins: 60, sessionRpe: 7, wearableCalories: null };

  it("adds nothing for a planned session done as planned", () => {
    expect(workoutExtraForDay([session], [planned(60)], 77, false).extraKcal).toBe(0);
  });

  it("adds an unplanned session in full and only the excess beyond a plan", () => {
    expect(workoutExtraForDay([session], [], 77, false).extraKcal).toBe(308);
    expect(workoutExtraForDay([{ ...session, durationMins: 90 }], [planned(60)], 77, false).extraKcal).toBe(154);
  });

  it("with sign-up training days instead of a plan, an hour counts as planned", () => {
    expect(workoutExtraForDay([session], [], 77, true).extraKcal).toBe(0);
  });

  it("explains a watch-based extra", () => {
    const extra = workoutExtraForDay([{ ...session, wearableCalories: 500 }], [], 77, false);
    expect(extra).toEqual({ extraKcal: 250, watchKcal: 500 });
    expect(workoutExtraLine(extra)).toMatch(/half of the 500 kcal your watch reported/);
    expect(workoutExtraLine({ extraKcal: 0, watchKcal: null })).toBeNull();
  });
});
