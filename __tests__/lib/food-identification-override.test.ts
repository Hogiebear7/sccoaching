import { describe, expect, it } from "vitest";

import type { IdentifiedFoodItem } from "@/lib/ai";
import type { FoodIdentificationOverrideRecord } from "@/lib/db";
import { applyFoodIdentificationOverrides, normalizeTriggerLabel } from "@/lib/food-identification-override";

function item(overrides: Partial<IdentifiedFoodItem>): IdentifiedFoodItem {
  return {
    name: "Milk",
    servingDescription: "250ml",
    calories: 120,
    proteinG: 8,
    carbsG: 12,
    fatG: 5,
    source: "estimate",
    ...overrides,
  };
}

function override(overrides: Partial<FoodIdentificationOverrideRecord>): FoodIdentificationOverrideRecord {
  return {
    id: "o1",
    userId: "u1",
    triggerLabel: "milk",
    preferredFood: { name: "Oat milk", calories: 80, proteinG: 1, carbsG: 14, fatG: 2, servingDescription: "240ml" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeTriggerLabel", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeTriggerLabel("  Milk  ")).toBe("milk");
    expect(normalizeTriggerLabel("Whole   Milk")).toBe("whole milk");
  });
});

describe("applyFoodIdentificationOverrides", () => {
  it("swaps in the preferred food when the identified name matches a trigger", () => {
    const result = applyFoodIdentificationOverrides([item({ name: "Milk" })], [override({})]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Oat milk");
    expect(result[0].calories).toBe(80);
    expect(result[0].servingDescription).toBe("240ml");
    expect(result[0].overridden).toBe(true);
  });

  it("matches case/whitespace-insensitively", () => {
    const result = applyFoodIdentificationOverrides([item({ name: "  MILK " })], [override({})]);
    expect(result[0].overridden).toBe(true);
  });

  it("leaves non-matching items untouched with overridden: false", () => {
    const result = applyFoodIdentificationOverrides([item({ name: "Banana" })], [override({})]);
    expect(result[0].name).toBe("Banana");
    expect(result[0].overridden).toBe(false);
  });

  it("is a no-op with no overrides at all", () => {
    const result = applyFoodIdentificationOverrides([item({ name: "Milk" })], []);
    expect(result[0].name).toBe("Milk");
    expect(result[0].overridden).toBe(false);
  });

  it("only matches exactly — never fuzzy-substitutes a near-miss", () => {
    const result = applyFoodIdentificationOverrides([item({ name: "Milk chocolate" })], [override({})]);
    expect(result[0].name).toBe("Milk chocolate");
    expect(result[0].overridden).toBe(false);
  });

  it("preserves the original source field on a swapped item", () => {
    const result = applyFoodIdentificationOverrides([item({ name: "Milk", source: "label" })], [override({})]);
    expect(result[0].source).toBe("label");
  });
});
