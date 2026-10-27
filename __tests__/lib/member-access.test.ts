import { describe, expect, it } from "vitest";

import { hasAccess, hasGymMembership, NO_ACCESS, type MemberAccess, type MemberFeature } from "@/lib/member-access";

const FEATURES: MemberFeature[] = [
  "workoutGenerate",
  "trackerImport",
  "workoutReview",
  "foodSearch",
  "unlimitedCustomFoods",
  "nutritionMoreTools",
  "gymProfiles",
  "notifications",
  "aiCoachChat",
  "aiNutritionCoachChat",
];

describe("hasAccess: every gated feature is a DIGITAL feature (owner decision D1)", () => {
  it.each(FEATURES)("%s follows the digital flag and ignores the gym Membership", (feature) => {
    expect(hasAccess({ digital: true, gymMembership: false }, feature)).toBe(true);
    expect(hasAccess({ digital: true, gymMembership: true }, feature)).toBe(true);
    expect(hasAccess({ digital: false, gymMembership: true }, feature)).toBe(false);
    expect(hasAccess(NO_ACCESS, feature)).toBe(false);
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
