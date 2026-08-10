import { describe, expect, it } from "vitest";

import { parseFoodEntryInput, recentDistinctFoods, sumDailyTotals } from "@/lib/nutrition-diary";
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
