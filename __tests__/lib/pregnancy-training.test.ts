import { describe, expect, it } from "vitest";

import { exerciseFlagFor, trainingGuidanceFor } from "@/lib/pregnancy-training";

const pregnant = (weeksPregnant: number) =>
  ({ kind: "pregnant", trimester: weeksPregnant < 14 ? 1 : weeksPregnant < 28 ? 2 : 3, weeksPregnant }) as const;
const afterBirth = (weeksSinceBirth: number) => ({ kind: "postpartum", weeksSinceBirth, breastfeeding: false }) as const;

describe("exerciseFlagFor", () => {
  it("flags lying on the back from 16 weeks, with a swap", () => {
    expect(exerciseFlagFor("Barbell Bench Press", pregnant(10))).toBeNull();
    expect(exerciseFlagFor("Barbell Bench Press", pregnant(18))?.swap).toMatch(/incline/i);
    expect(exerciseFlagFor("Glute Bridge", pregnant(20))).not.toBeNull();
  });

  it("leaves incline, standing and seated versions alone", () => {
    expect(exerciseFlagFor("Incline Dumbbell Press", pregnant(30))).toBeNull();
    expect(exerciseFlagFor("Seated Cable Row", pregnant(30))).toBeNull();
    expect(exerciseFlagFor("Back Squat", pregnant(30))).toBeNull();
  });

  it("flags jumping in pregnancy and running before 12 weeks after the birth", () => {
    expect(exerciseFlagFor("Box Jump", pregnant(20))).not.toBeNull();
    expect(exerciseFlagFor("Easy Run", afterBirth(8))?.reason).toMatch(/12 weeks/);
    expect(exerciseFlagFor("Easy Run", afterBirth(14))).toBeNull();
  });

  it("flags nothing without a stage", () => {
    expect(exerciseFlagFor("Box Jump", null)).toBeNull();
  });
});

describe("trainingGuidanceFor", () => {
  it("lowers the effort range in the third trimester", () => {
    expect(trainingGuidanceFor(pregnant(20))?.effort).toMatch(/5–7/);
    expect(trainingGuidanceFor(pregnant(32))?.effort).toMatch(/4–6/);
    expect(trainingGuidanceFor(pregnant(20))?.points.join(" ")).toMatch(/150 minutes/);
  });

  it("phases the return after the birth and ends at 12 weeks", () => {
    expect(trainingGuidanceFor(afterBirth(2))?.headline).toMatch(/first 6 weeks/);
    expect(trainingGuidanceFor(afterBirth(8))?.points.join(" ")).toMatch(/No running/);
    expect(trainingGuidanceFor(afterBirth(13))).toBeNull();
  });
});
