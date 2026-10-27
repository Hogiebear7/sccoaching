import { describe, expect, it } from "vitest";

import {
  FREE_HISTORY_DAYS,
  FREE_SAVED_MEAL_LIMIT,
  FREE_SAVED_WORKOUT_LIMIT,
  freeHistoryStartDate,
  hasAccess,
  hasGymMembership,
  NO_ACCESS,
  type MemberAccess,
  type MemberFeature,
} from "@/lib/member-access";

// Owner decisions 2026-10-27: Free keeps logging (food search, custom foods) and notifications; the App subscription (digital) unlocks the rest,
// including all AI; the gym Membership adds only direct coach messaging.
const FREE_FEATURES: MemberFeature[] = ["foodSearch", "unlimitedCustomFoods", "notifications"];
const DIGITAL_FEATURES: MemberFeature[] = [
  "workoutGenerate",
  "trackerImport",
  "workoutReview",
  "nutritionMoreTools",
  "gymProfiles",
  "aiCoachChat",
  "aiNutritionCoachChat",
  "unlimitedSavedWorkouts",
  "unlimitedSavedMeals",
  "programmes",
  "weeklyPlanner",
  "calorieTargets",
  "fullHistory",
  "cyclePhaseGuidance",
  "communityLeaderboards",
];

describe("hasAccess: Free features are open to everyone", () => {
  it.each(FREE_FEATURES)("%s is allowed with no plan at all", (feature) => {
    expect(hasAccess(NO_ACCESS, feature)).toBe(true);
    expect(hasAccess({ digital: true, gymMembership: true }, feature)).toBe(true);
  });
});

describe("hasAccess: App subscription features follow the digital flag and ignore the gym Membership (owner decision D1)", () => {
  it.each(DIGITAL_FEATURES)("%s", (feature) => {
    expect(hasAccess({ digital: true, gymMembership: false }, feature)).toBe(true);
    expect(hasAccess({ digital: true, gymMembership: true }, feature)).toBe(true);
    expect(hasAccess({ digital: false, gymMembership: true }, feature)).toBe(false);
    expect(hasAccess(NO_ACCESS, feature)).toBe(false);
  });
});

describe("hasAccess: coach messaging is the gym Membership's, not the App subscription's", () => {
  it("follows the gym Membership flag only", () => {
    expect(hasAccess({ digital: false, gymMembership: true }, "coachMessaging")).toBe(true);
    expect(hasAccess({ digital: true, gymMembership: false }, "coachMessaging")).toBe(false);
    expect(hasAccess(NO_ACCESS, "coachMessaging")).toBe(false);
  });
});

describe("Free-tier allowances", () => {
  it("are 3 saved workouts, 5 saved meals and 7 days of history", () => {
    expect([FREE_SAVED_WORKOUT_LIMIT, FREE_SAVED_MEAL_LIMIT, FREE_HISTORY_DAYS]).toEqual([3, 5, 7]);
  });

  it("history reaches back to today and the 6 days before", () => {
    expect(freeHistoryStartDate(new Date("2026-10-27T15:00:00Z"))).toBe("2026-10-21");
  });
});

describe("hasGymMembership", () => {
  it("is true only when the gym Membership flag is set, whatever the digital flag says", () => {
    const cases: [MemberAccess, boolean][] = [
      [{ digital: false, gymMembership: true }, true],
      [{ digital: true, gymMembership: true }, true],
      [{ digital: true, gymMembership: false }, false],
      [NO_ACCESS, false],
    ];
    for (const [access, expected] of cases) expect(hasGymMembership(access)).toBe(expected);
  });
});
