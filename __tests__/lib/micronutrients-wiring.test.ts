// Vitamins and minerals travel with a food: scaled to the amount eaten, kept on the diary entry and favourite, added up per nutrient with unknown never counted as zero, and absent
// for foods that list none (so every food without them behaves exactly as before).
import { describe, expect, it } from "vitest";

import type { FoodEntryRecord, FoodNutrition100g } from "@/lib/db";
import { nutritionForGrams, parseCustomFoodInput } from "@/lib/food-catalog";
import { parseFoodEntryInput, parseNutrientExtras, sumMicroTotals } from "@/lib/nutrition-diary";

const base: FoodNutrition100g = { calories: 100, proteinG: 10, carbsG: 10, fatG: 1, fiberG: null, sugarG: null, sodiumMg: null, saturatedFatG: null };

describe("scaling a food to an amount", () => {
  it("carries micronutrients and water scaled to the grams eaten", () => {
    const n = nutritionForGrams({ ...base, micros: { ironMg: 2, vitaminCMg: 40 }, waterG: 80 }, 150);
    expect(n.micros).toEqual({ ironMg: 3, vitaminCMg: 60 });
    expect(n.waterG).toBe(120);
  });

  it("a food that lists none scales to exactly what it did before (no extra keys)", () => {
    const n = nutritionForGrams(base, 150);
    expect("micros" in n).toBe(false);
    expect("waterG" in n).toBe(false);
  });
});

describe("a diary entry or favourite body", () => {
  it("keeps valid micronutrients and water, drops junk, and omits the key when none are valid", () => {
    expect(parseNutrientExtras({ micros: { ironMg: 4.5, calciumMg: -3, nope: 1 }, waterG: 200 })).toEqual({ micros: { ironMg: 4.5 }, waterG: 200 });
    expect(parseNutrientExtras({ micros: { calciumMg: -3 } })).toEqual({});
    expect(parseNutrientExtras({})).toEqual({});
  });

  it("the entry parser passes them through", () => {
    const r = parseFoodEntryInput({ date: "2026-11-26", mealType: "lunch", name: "Spinach", calories: 20, proteinG: 2, carbsG: 3, fatG: 0, micros: { ironMg: 2.7, folateUg: 190 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.micros).toEqual({ ironMg: 2.7, folateUg: 190 });
  });
});

describe("a member-created food", () => {
  it("can list micronutrients per 100 g", () => {
    const r = parseCustomFoodInput({ name: "My bar", nutrition100g: { calories: 400, proteinG: 20, carbsG: 40, fatG: 15, micros: { ironMg: 3, bogus: 9 }, waterG: 5 }, servings: [] } as never);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.nutrition100g.micros).toEqual({ ironMg: 3 });
      expect(r.value.nutrition100g.waterG).toBe(5);
    }
  });
});

describe("a day's totals", () => {
  const entry = (micros?: Record<string, number>): FoodEntryRecord => ({ id: Math.random().toString(), userId: "u", date: "2026-11-26", mealType: "lunch", name: "x", calories: 1, proteinG: 0, carbsG: 0, fatG: 0, createdAt: "t", ...(micros ? { micros } : {}) });

  it("adds only the entries that list a nutrient and says how many did", () => {
    const t = sumMicroTotals([entry({ ironMg: 2 }), entry({ ironMg: 1 }), entry()]);
    const iron = t.find((x) => x.key === "ironMg")!;
    expect(iron).toMatchObject({ total: 3, listedBy: 2, entryCount: 3, atLeast: true });
    expect(t.find((x) => x.key === "zincMg")).toMatchObject({ listedBy: 0 });
  });
});
