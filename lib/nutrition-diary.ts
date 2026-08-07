import type { FoodEntryRecord, MealType } from "./db";

export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export function parseMealType(value: unknown): MealType | null {
  return typeof value === "string" && MEAL_TYPES.includes(value as MealType) ? (value as MealType) : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export interface ParsedFoodEntryInput {
  date: string;
  mealType: MealType;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFoodEntryInput(body: Record<string, unknown>): { ok: true; value: ParsedFoodEntryInput } | { ok: false; message: string } {
  const { date, mealType, name, calories, proteinG, carbsG, fatG } = body;

  if (typeof date !== "string" || !ISO_DATE_RE.test(date)) {
    return { ok: false, message: "Date must be a valid YYYY-MM-DD string." };
  }
  const parsedMealType = parseMealType(mealType);
  if (!parsedMealType) {
    return { ok: false, message: "A valid meal type is required." };
  }
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, message: "Food name is required." };
  }
  const cals = nonNegativeNumber(calories);
  if (cals === null) {
    return { ok: false, message: "Calories must be a non-negative number." };
  }

  return {
    ok: true,
    value: {
      date,
      mealType: parsedMealType,
      name: name.trim().slice(0, 120),
      calories: cals,
      proteinG: nonNegativeNumber(proteinG) ?? 0,
      carbsG: nonNegativeNumber(carbsG) ?? 0,
      fatG: nonNegativeNumber(fatG) ?? 0,
    },
  };
}

export interface DailyTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function sumDailyTotals(entries: FoodEntryRecord[]): DailyTotals {
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
}

// Most-recently-logged distinct foods (by name, case-insensitive) — the
// manual-entry "quick add" list since there's no external food database.
export function recentDistinctFoods(entries: FoodEntryRecord[], limit = 20): FoodEntryRecord[] {
  const seen = new Set<string>();
  const out: FoodEntryRecord[] = [];
  for (const e of entries) {
    const key = e.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
