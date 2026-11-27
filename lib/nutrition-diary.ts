import type { FoodDomain, FoodEntryRecord, FoodRecord, MealType } from "./db";
import { hasAnyMicros, parseMicros, parseWaterG, scaleMicros, sumMicros, type MicroMap, type MicroTotal } from "./micronutrients";

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
  /** Vitamins, minerals and omega-3 the food lists (lib/micronutrients.ts); absent when none are known. */
  micros?: MicroMap;
  /** Grams of water in the logged amount, where known. */
  waterG?: number;
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
  const micros = parseMicros(body.micros);
  if (hasAnyMicros(micros)) out.micros = micros;
  const water = parseWaterG(body.waterG);
  if (water !== null) out.waterG = water;
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

/**
 * Vitamins, minerals and water for an entry logged from the shared food library (common or branded foods) when the app did not send them: scaled from the food's own per-100 g values
 * to the amount eaten (serving grams x quantity). The app sends only fibre, sugar, sodium and saturated fat, so without this a logged banana would carry no vitamins. A value the app DID
 * send always wins, a food that lists no vitamins adds nothing (unknown is never zero), and a member's own custom foods are not looked up here.
 */
export function catalogNutrientsForEntry(
  input: Pick<ParsedFoodEntryInput, "foodId" | "foodDomain" | "servingGrams" | "quantity" | "micros" | "waterG">,
  lookup: (domain: FoodDomain, id: string) => FoodRecord | undefined,
): { micros?: MicroMap; waterG?: number } {
  if (!input.foodId || (input.foodDomain !== "common" && input.foodDomain !== "branded")) return {};
  const grams = (input.servingGrams ?? 0) * (input.quantity ?? 1);
  if (!Number.isFinite(grams) || grams <= 0) return {};
  const food = lookup(input.foodDomain, input.foodId);
  if (!food) return {};
  const out: { micros?: MicroMap; waterG?: number } = {};
  if (!hasAnyMicros(input.micros) && hasAnyMicros(food.nutrition100g.micros)) out.micros = scaleMicros(food.nutrition100g.micros, grams / 100);
  const water = food.nutrition100g.waterG;
  if (input.waterG === undefined && typeof water === "number" && Number.isFinite(water)) out.waterG = Math.round(water * (grams / 100) * 10) / 10;
  return out;
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

/** The day's vitamins, minerals and omega-3 from the entries that list them, with how many entries did (lib/micronutrients.ts: unknown is never zero). */
export function sumMicroTotals(entries: readonly FoodEntryRecord[]): MicroTotal[] {
  return sumMicros(entries);
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
