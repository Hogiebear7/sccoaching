import { describe, expect, it } from "vitest";

import type { FoodRecord } from "@/lib/db";
import { getFoodSubmissionEligibility, mapFoodToOffSubmissionPayload } from "@/lib/food-submission";

function makeFood(overrides: Partial<FoodRecord>): FoodRecord {
  return {
    id: "f1",
    domain: "custom",
    name: "Protein Flapjack",
    brandName: "Kitchen made",
    barcode: "5901234123457",
    nutrition100g: { calories: 417, proteinG: 25, carbsG: 50, fatG: 15, fiberG: null, sugarG: null, sodiumMg: null, saturatedFatG: null },
    defaultServing: { label: "1 serving", grams: 60 },
    servings: [{ label: "1 serving", grams: 60 }, { label: "100g", grams: 100 }],
    provenance: "user",
    sourceRef: null,
    verified: false,
    region: null,
    ownerUserId: "u1",
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fetchedAt: null,
    ...overrides,
  };
}

describe("getFoodSubmissionEligibility", () => {
  it("is eligible when domain is custom and brand/barcode are present", () => {
    const result = getFoodSubmissionEligibility(makeFood({}));
    expect(result).toEqual({ eligibility: "eligible_for_submission", missingFields: [] });
  });

  it("is private_only for common/branded foods regardless of data completeness", () => {
    expect(getFoodSubmissionEligibility(makeFood({ domain: "common" })).eligibility).toBe("private_only");
    expect(getFoodSubmissionEligibility(makeFood({ domain: "branded" })).eligibility).toBe("private_only");
  });

  it("flags a missing brand name", () => {
    const result = getFoodSubmissionEligibility(makeFood({ brandName: null }));
    expect(result.eligibility).toBe("private_only");
    expect(result.missingFields).toContain("brandName");
  });

  it("flags a missing barcode", () => {
    const result = getFoodSubmissionEligibility(makeFood({ barcode: null }));
    expect(result.eligibility).toBe("private_only");
    expect(result.missingFields).toContain("barcode");
  });

  it("flags both when neither brand nor barcode is set", () => {
    const result = getFoodSubmissionEligibility(makeFood({ brandName: null, barcode: null }));
    expect(result.missingFields).toEqual(expect.arrayContaining(["brandName", "barcode"]));
  });
});

describe("mapFoodToOffSubmissionPayload", () => {
  it("maps an eligible food to the OFF write shape", () => {
    const payload = mapFoodToOffSubmissionPayload(makeFood({}));
    expect(payload).toEqual({
      barcode: "5901234123457",
      name: "Protein Flapjack",
      brandName: "Kitchen made",
      nutrition100g: { calories: 417, proteinG: 25, carbsG: 50, fatG: 15, fiberG: null, sugarG: null, sodiumMg: null, saturatedFatG: null },
      servingLabel: "1 serving",
      servingGrams: 60,
      frontPhotoUrl: null,
      labelPhotoUrl: null,
    });
  });

  it("carries through optional photos when provided", () => {
    const payload = mapFoodToOffSubmissionPayload(makeFood({}), { frontPhotoUrl: "data:image/jpeg;base64,abc", labelPhotoUrl: "data:image/jpeg;base64,def" });
    expect(payload.frontPhotoUrl).toBe("data:image/jpeg;base64,abc");
    expect(payload.labelPhotoUrl).toBe("data:image/jpeg;base64,def");
  });

  it("throws for a food missing barcode or brand — callers must check eligibility first", () => {
    expect(() => mapFoodToOffSubmissionPayload(makeFood({ barcode: null }))).toThrow();
    expect(() => mapFoodToOffSubmissionPayload(makeFood({ brandName: null }))).toThrow();
  });
});
