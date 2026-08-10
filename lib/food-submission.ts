// Eligibility + payload mapping for the "submit a custom food to Open Food
// Facts" workflow. Kept separate from lib/food-catalog.ts (which owns
// search/ranking/normalization) since this is a distinct concern: deciding
// whether a *private* food has enough data to go public, and shaping it for
// an external write. See docs/food-catalog.md for the full workflow.

import type { FoodNutrition100g, FoodRecord } from "./db";

export type FoodSubmissionEligibility = "private_only" | "eligible_for_submission";

export interface SubmissionEligibilityResult {
  eligibility: FoodSubmissionEligibility;
  missingFields: string[];
}

// Only a member's own custom foods are ever private — common/branded are
// already public catalog entries, so "submission" doesn't apply to them.
// Among the fields required for a useful OFF listing (brand, name, barcode,
// serving, calories/protein/carbs/fat), name/serving/macros are already
// non-nullable on FoodRecord — the only fields that can actually be missing
// are brandName and barcode, so those are the real gate.
export function getFoodSubmissionEligibility(food: FoodRecord): SubmissionEligibilityResult {
  const missingFields: string[] = [];

  if (food.domain !== "custom") {
    return { eligibility: "private_only", missingFields: ["domain must be a custom food"] };
  }
  if (!food.brandName?.trim()) missingFields.push("brandName");
  if (!food.barcode?.trim()) missingFields.push("barcode");
  if (!food.defaultServing || food.defaultServing.grams <= 0) missingFields.push("servingSize");
  if (!Number.isFinite(food.nutrition100g?.calories)) missingFields.push("calories");
  if (!Number.isFinite(food.nutrition100g?.proteinG)) missingFields.push("protein");
  if (!Number.isFinite(food.nutrition100g?.carbsG)) missingFields.push("carbs");
  if (!Number.isFinite(food.nutrition100g?.fatG)) missingFields.push("fat");

  return {
    eligibility: missingFields.length === 0 ? "eligible_for_submission" : "private_only",
    missingFields,
  };
}

export interface OffSubmissionPayload {
  barcode: string;
  name: string;
  brandName: string;
  nutrition100g: FoodNutrition100g;
  servingLabel: string;
  servingGrams: number;
  frontPhotoUrl: string | null;
  labelPhotoUrl: string | null;
}

// Pure mapping from our normalized schema to the shape an OFF write would
// need. Deliberately doesn't touch the network — lib/open-food-facts-client.ts
// owns the actual (currently unconfigured) write call.
export function mapFoodToOffSubmissionPayload(
  food: FoodRecord,
  photos: { frontPhotoUrl?: string | null; labelPhotoUrl?: string | null } = {}
): OffSubmissionPayload {
  if (!food.barcode || !food.brandName) {
    throw new Error("mapFoodToOffSubmissionPayload requires a barcode and brandName — check eligibility first.");
  }
  return {
    barcode: food.barcode,
    name: food.name,
    brandName: food.brandName,
    nutrition100g: food.nutrition100g,
    servingLabel: food.defaultServing.label,
    servingGrams: food.defaultServing.grams,
    frontPhotoUrl: photos.frontPhotoUrl ?? null,
    labelPhotoUrl: photos.labelPhotoUrl ?? null,
  };
}
