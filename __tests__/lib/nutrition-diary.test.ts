import { describe, expect, it } from "vitest";

import { parseFoodEntryInput, parseNutrientExtras, recentDistinctFoods, sumDailyTotals, sumExtraTotals } from "@/lib/nutrition-diary";
import type { FoodEntryRecord } from "@/lib/db";

describe("parseFoodEntryInput", () => {
  it("parses a valid entry, defaulting omitted macros and catalog fields", () => {
    const result = parseFoodEntryInput({ date: "2026-08-07", mealType: "breakfast", name: " Oats ", calories: 350 });
    expect(result).toEqual({
      ok: true,
      value: {
        date: "2026-08-07",
        mealType: "breakfast",
        name: "Oats",
        calories: 350,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        foodId: null,
        foodDomain: null,
        servingLabel: null,
        servingGrams: null,
        quantity: null,
      },
    });
  });

  it("rejects an invalid date, meal type, missing name, or negative calories", () => {
    expect(parseFoodEntryInput({ date: "07-08-2026", mealType: "breakfast", name: "Oats", calories: 100 }).ok).toBe(false);
    expect(parseFoodEntryInput({ date: "2026-08-07", mealType: "brunch", name: "Oats", calories: 100 }).ok).toBe(false);
    expect(parseFoodEntryInput({ date: "2026-08-07", mealType: "breakfast", name: "", calories: 100 }).ok).toBe(false);
    expect(parseFoodEntryInput({ date: "2026-08-07", mealType: "breakfast", name: "Oats", calories: -5 }).ok).toBe(false);
  });

  it("parses catalog-linked fields, preserving decimal quantity/servingGrams", () => {
    const result = parseFoodEntryInput({
      date: "2026-08-07",
      mealType: "lunch",
      name: "Banana",
      calories: 133,
      proteinG: 2,
      carbsG: 35,
      fatG: 0,
      foodId: "food-1",
      foodDomain: "common",
      servingLabel: "1 medium (118g)",
      servingGrams: 177,
      quantity: 1.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.foodId).toBe("food-1");
    expect(result.value.foodDomain).toBe("common");
    expect(result.value.servingLabel).toBe("1 medium (118g)");
    expect(result.value.servingGrams).toBe(177);
    expect(result.value.quantity).toBe(1.5);
  });

  it("rejects an unknown foodDomain rather than passing it through", () => {
    const result = parseFoodEntryInput({ date: "2026-08-07", mealType: "lunch", name: "X", calories: 1, foodDomain: "bogus" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.foodDomain).toBeNull();
  });
});

describe("sumDailyTotals", () => {
  function entry(overrides: Partial<FoodEntryRecord>): FoodEntryRecord {
    return {
      id: "1",
      userId: "u1",
      date: "2026-08-07",
      mealType: "breakfast",
      name: "Oats",
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      createdAt: "x",
      ...overrides,
    };
  }

  it("sums calories and macros across entries", () => {
    const totals = sumDailyTotals([
      entry({ calories: 350, proteinG: 12, carbsG: 60, fatG: 6 }),
      entry({ calories: 200, proteinG: 20, carbsG: 5, fatG: 8 }),
    ]);
    expect(totals).toEqual({ calories: 550, proteinG: 32, carbsG: 65, fatG: 14 });
  });

  it("returns all zeroes for an empty list", () => {
    expect(sumDailyTotals([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });
});

describe("recentDistinctFoods", () => {
  function entry(name: string, createdAt: string): FoodEntryRecord {
    return {
      id: name + createdAt,
      userId: "u1",
      date: "2026-08-07",
      mealType: "snack",
      name,
      calories: 100,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      createdAt,
    };
  }

  it("dedupes by name case-insensitively, keeping the first (most recent) occurrence", () => {
    const entries = [entry("Banana", "3"), entry("banana", "2"), entry("Apple", "1")];
    const result = recentDistinctFoods(entries);
    expect(result.map((e) => e.createdAt)).toEqual(["3", "1"]);
  });

  it("caps at the given limit", () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(`Food ${i}`, String(i)));
    expect(recentDistinctFoods(entries, 5)).toHaveLength(5);
  });
});

describe("nutrient extras (fibre, sugar, sodium, saturated fat)", () => {
  it("keeps only values that are known and sensible, rounding fibre/sugar/sat fat to 1 decimal and sodium to whole mg", () => {
    expect(parseNutrientExtras({ fiberG: 3.456, sugarG: 12, sodiumMg: 480.6, saturatedFatG: 1.04 })).toEqual({ fiberG: 3.5, sugarG: 12, sodiumMg: 481, saturatedFatG: 1 });
    expect(parseNutrientExtras({ fiberG: -1, sugarG: "7", sodiumMg: NaN, saturatedFatG: 99999 })).toEqual({});
    expect(parseNutrientExtras({})).toEqual({});
  });

  it("a known zero is kept (zero fibre is real), a missing value is left out", () => {
    expect(parseNutrientExtras({ fiberG: 0 })).toEqual({ fiberG: 0 });
  });

  it("flows through parseFoodEntryInput without changing the old shape when absent", () => {
    const plain = parseFoodEntryInput({ date: "2026-08-07", mealType: "lunch", name: "Soup", calories: 200 });
    expect(plain.ok && Object.keys(plain.value)).not.toContain("fiberG");
    const withExtras = parseFoodEntryInput({ date: "2026-08-07", mealType: "lunch", name: "Soup", calories: 200, fiberG: 4.2, sodiumMg: 900 });
    expect(withExtras.ok && withExtras.value).toMatchObject({ fiberG: 4.2, sodiumMg: 900 });
  });
});

describe("sumExtraTotals", () => {
  const entry = (over: Partial<FoodEntryRecord>): FoodEntryRecord =>
    ({ id: "e", userId: "u", date: "2026-08-07", mealType: "lunch", name: "x", calories: 100, proteinG: 1, carbsG: 1, fatG: 1, createdAt: "", ...over }) as FoodEntryRecord;

  it("adds up what is listed and counts entries that do not list each nutrient, so the app can say 'at least'", () => {
    const t = sumExtraTotals([
      entry({ fiberG: 5, sugarG: 10.5, sodiumMg: 300, saturatedFatG: 2 }),
      entry({ fiberG: 2.2, sodiumMg: 150 }),
      entry({}),
    ]);
    expect(t).toMatchObject({ fiberG: 7.2, sugarG: 10.5, sodiumMg: 450, saturatedFatG: 2, totalEntries: 3 });
    expect(t.missing).toEqual({ fiberG: 1, sugarG: 2, sodiumMg: 1, saturatedFatG: 2 });
  });

  it("is all zeros with nothing missing for an empty day", () => {
    expect(sumExtraTotals([])).toEqual({ fiberG: 0, sugarG: 0, sodiumMg: 0, saturatedFatG: 0, missing: { fiberG: 0, sugarG: 0, sodiumMg: 0, saturatedFatG: 0 }, totalEntries: 0 });
  });
});
