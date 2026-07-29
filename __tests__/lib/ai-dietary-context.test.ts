import { describe, expect, it } from "vitest";

import { buildDietaryContextBlock } from "@/lib/ai-context";
import type { DietaryPreference, ProfileRecord } from "@/lib/profile-schema";

// buildDietaryContextBlock only reads dietary fields; build a minimal profile.
function profile(diet: Partial<ProfileRecord>): ProfileRecord {
  return {
    userId: "u1",
    fullName: "Test",
    email: "t@x.com",
    phone: "1",
    dateOfBirth: null,
    gender: "Other",
    primaryGoal: "General Health",
    sportPlayed: null,
    currentWeightKg: null,
    additionalInfo: null,
    cycleTrackingEligible: false,
    cycleTrackingEnabled: false,
    menopauseSupportEnabled: false,
    reminderTimingsMins: null,
    emailNotificationsEnabled: true,
    pushNotificationsEnabled: false,
    onboardingCompleted: true,
    createdAt: "x",
    updatedAt: "x",
    ...diet,
  };
}

const build = (diet: {
  dietaryPreference?: DietaryPreference;
  allergies?: string[];
  intolerancesOrMedical?: string[];
  dietaryNotes?: string | null;
}) => buildDietaryContextBlock(profile(diet));

describe("buildDietaryContextBlock — grounds AI food advice", () => {
  it("vegan member: safe suggestions are vegan-compatible (no meat/fish/dairy)", () => {
    const block = build({ dietaryPreference: "vegan" });
    expect(block).toContain("Vegan");
    // plant proteins present, animal ones absent
    expect(block).toContain("Tofu");
    expect(block).toContain("Lentils");
    expect(block).not.toContain("Chicken breast");
    expect(block).not.toContain("Salmon");
    expect(block).not.toContain("Eggs");
    expect(block).not.toContain("Greek yogurt");
  });

  it("pescetarian + fish allergy: NO fish suggestions (Salmon), fish listed as never-appear", () => {
    const block = build({ dietaryPreference: "pescetarian", allergies: ["fish"] });
    expect(block).not.toContain("Salmon");
    // preference allows seafood without the fish allergen (Prawns = shellfish)
    expect(block).toContain("Prawns");
    // the hard exclusion is surfaced explicitly
    expect(block).toMatch(/never appear[^\n]*Fish/i);
  });

  it("allergies OVERRIDE preference: pescetarian allows fish, but fish allergy removes Salmon", () => {
    const withAllergy = build({ dietaryPreference: "pescetarian", allergies: ["fish"] });
    const withoutAllergy = build({ dietaryPreference: "pescetarian" });
    // Without the allergy, a pescetarian WOULD see Salmon…
    expect(withoutAllergy).toContain("Salmon");
    // …with the allergy, the exclusion wins.
    expect(withAllergy).not.toContain("Salmon");
  });

  it("coeliac + lactose intolerant: derived exclusions block gluten & dairy foods", () => {
    const block = build({ intolerancesOrMedical: ["coeliac", "lactose_intolerant"] });
    expect(block).toMatch(/never appear/i);
    expect(block).toContain("Gluten");
    expect(block).toContain("Milk / dairy");
    // gluten/dairy foods excluded from the safe list
    expect(block).not.toContain("Wholegrain bread");
    expect(block).not.toContain("Cheese");
    // gluten-free carbs remain
    expect(block).toContain("Brown rice");
  });

  it("empty dietary profile: backward-compatible, no restrictions", () => {
    const block = build({});
    expect(block).toContain("No specific preference");
    expect(block).toContain("none recorded");
    expect(block).toMatch(/no restrictions/i);
  });

  it("always states the hard-exclusion + professional-referral rule", () => {
    const block = build({ dietaryPreference: "vegan", allergies: ["peanuts"] });
    expect(block).toMatch(/never recommend a food that contains an excluded ingredient/i);
    expect(block).toMatch(/qualified professional/i);
    expect(block).toMatch(/suggestion filter|never permits overriding an exclusion/i);
  });
});
