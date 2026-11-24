import type { FoodDomain, FoodEntryRecord, MealType } from "./db";

const FOOD_DOMAINS: FoodDomain[] = ["custom", "common", "branded"];

export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export function parseMealType(value: unknown): MealType | null {
  return typeof value === "string" && MEAL_TYPES.includes(value as MealType) ? (value as MealType) : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

// Unlike nonNegativeNumber, doesn't round — quantity ("1.5 servings") and
// servingGrams need decimal precision preserved.
function nonNegativeDecimal(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Fibre, total sugars, sodium and saturated fat for an entry. A key is present only when the value is known, so "not listed" is never read as zero. */
export interface NutrientExtras {
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
  saturatedFatG?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Reads the optional extras from a request body. Anything missing, negative, not a number or absurdly large is left out. */
export function parseNutrientExtras(body: Record<string, unknown>): NutrientExtras {
  const out: NutrientExtras = {};
  const grams = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 2000 ? round1(v) : null);
  const fiber = grams(body.fiberG);
  const sugar = grams(body.sugarG);
  const satFat = grams(body.saturatedFatG);
  const sodium = typeof body.sodiumMg === "number" && Number.isFinite(body.sodiumMg) && body.sodiumMg >= 0 && body.sodiumMg <= 200000 ? Math.round(body.sodiumMg) : null;
  if (fiber !== null) out.fiberG = fiber;
  if (sugar !== null) out.sugarG = sugar;
  if (sodium !== null) out.sodiumMg = sodium;
  if (satFat !== null) out.saturatedFatG = satFat;
  return out;
}

export interface ParsedFoodEntryInput extends NutrientExtras {
  date: string;
  mealType: MealType;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  foodId: string | null;
  foodDomain: FoodDomain | null;
  servingLabel: string | null;
  servingGrams: number | null;
  quantity: number | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// foodId/foodDomain/servingLabel/servingGrams/quantity are optional —
// present when the entry came from the food catalog (search/barcode/quick-
// add), absent for a hand-typed entry. The client is trusted to have
// already computed calories/macros for the chosen serving × quantity (the
// same gramsForServing/nutritionForGrams math in lib/food-catalog.ts); this
// endpoint stores the snapshot rather than recomputing it, so a later edit
// to the catalog food's nutrition never silently rewrites history.
export function parseFoodEntryInput(body: Record<string, unknown>): { ok: true; value: ParsedFoodEntryInput } | { ok: false; message: string } {
  const { date, mealType, name, calories, proteinG, carbsG, fatG, foodId, foodDomain, servingLabel, servingGrams, quantity } = body;

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

  const parsedFoodDomain = typeof foodDomain === "string" && FOOD_DOMAINS.includes(foodDomain as FoodDomain) ? (foodDomain as FoodDomain) : null;

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
      foodId: typeof foodId === "string" && foodId.trim() ? foodId.trim() : null,
      foodDomain: parsedFoodDomain,
      servingLabel: typeof servingLabel === "string" && servingLabel.trim() ? servingLabel.trim() : null,
      servingGrams: nonNegativeDecimal(servingGrams),
      quantity: nonNegativeDecimal(quantity),
      ...parseNutrientExtras(body),
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

export interface ExtraTotals {
  fiberG: number;
  sugarG: number;
  sodiumMg: number;
  saturatedFatG: number;
  /** How many of the day's entries have no value for each nutrient. Above zero means the total is a minimum, not the full amount. */
  missing: { fiberG: number; sugarG: number; sodiumMg: number; saturatedFatG: number };
  totalEntries: number;
}

/** The day's fibre, sugar, sodium and saturated fat from entries that list them, and how many entries did not (so the app can say "at least"). */
export function sumExtraTotals(entries: FoodEntryRecord[]): ExtraTotals {
  const out: ExtraTotals = {
    fiberG: 0,
    sugarG: 0,
    sodiumMg: 0,
    saturatedFatG: 0,
    missing: { fiberG: 0, sugarG: 0, sodiumMg: 0, saturatedFatG: 0 },
    totalEntries: entries.length,
  };
  for (const e of entries) {
    for (const key of ["fiberG", "sugarG", "sodiumMg", "saturatedFatG"] as const) {
      const v = e[key];
      if (typeof v === "number") out[key] += v;
      else out.missing[key] += 1;
    }
  }
  out.fiberG = round1(out.fiberG);
  out.sugarG = round1(out.sugarG);
  out.saturatedFatG = round1(out.saturatedFatG);
  out.sodiumMg = Math.round(out.sodiumMg);
  return out;
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
