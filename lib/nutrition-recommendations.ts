// Food suggestions for the Nutrition tab, filtered by a member's dietary
// requirements. Pure and deterministic.
//
// Safety contract:
//  - allergies + intolerances/medical are HARD exclusions: a food is dropped if
//    it contains ANY excluded allergen. Recommendations can never include an
//    item that violates a hard exclusion.
//  - dietaryPreference filters by diet class (vegan/vegetarian/pescetarian/
//    standard) and lightly ranks the remaining items.

import type { DietaryPreference } from "./profile-schema";

export type FoodGroup = "protein" | "carb" | "snack";

// Diet classification used by the preference filter.
//  meat            — excluded for pescetarian, vegetarian, vegan
//  fish            — seafood (incl. shellfish); excluded for vegetarian, vegan
//  animal_product  — dairy/eggs; excluded for vegan
//  none            — plant-based; allowed for everyone
export type FoodAnimalClass = "meat" | "fish" | "animal_product" | "none";

export interface FoodItem {
  name: string;
  group: FoodGroup;
  animal: FoodAnimalClass;
  /** Allergen keys present in this food (see ALLERGEN_OPTIONS vocabulary). */
  allergens: string[];
}

export interface DietaryProfile {
  dietaryPreference?: DietaryPreference;
  allergies?: string[];
  intolerancesOrMedical?: string[];
}

// Intolerance/medical keys → the allergen keys they must exclude.
const INTOLERANCE_TO_ALLERGENS: Record<string, string[]> = {
  coeliac: ["gluten"],
  lactose_intolerant: ["milk"],
};

// Curated catalog. Allergen tags are conservative (e.g. oats/bread carry
// "gluten") so hard exclusions err on the side of safety.
export const FOOD_CATALOG: FoodItem[] = [
  // Protein
  { name: "Chicken breast", group: "protein", animal: "meat", allergens: [] },
  { name: "Lean beef", group: "protein", animal: "meat", allergens: [] },
  { name: "Turkey", group: "protein", animal: "meat", allergens: [] },
  { name: "Salmon", group: "protein", animal: "fish", allergens: ["fish"] },
  { name: "Tuna", group: "protein", animal: "fish", allergens: ["fish"] },
  { name: "Prawns", group: "protein", animal: "fish", allergens: ["shellfish"] },
  { name: "Eggs", group: "protein", animal: "animal_product", allergens: ["eggs"] },
  { name: "Greek yogurt", group: "protein", animal: "animal_product", allergens: ["milk"] },
  { name: "Cottage cheese", group: "protein", animal: "animal_product", allergens: ["milk"] },
  { name: "Whey protein", group: "protein", animal: "animal_product", allergens: ["milk"] },
  { name: "Tofu", group: "protein", animal: "none", allergens: ["soy"] },
  { name: "Tempeh", group: "protein", animal: "none", allergens: ["soy"] },
  { name: "Lentils", group: "protein", animal: "none", allergens: [] },
  { name: "Chickpeas", group: "protein", animal: "none", allergens: [] },
  { name: "Black beans", group: "protein", animal: "none", allergens: [] },
  { name: "Pea protein", group: "protein", animal: "none", allergens: [] },

  // Carbs
  { name: "Brown rice", group: "carb", animal: "none", allergens: [] },
  { name: "White rice", group: "carb", animal: "none", allergens: [] },
  { name: "Quinoa", group: "carb", animal: "none", allergens: [] },
  { name: "Sweet potato", group: "carb", animal: "none", allergens: [] },
  { name: "Potatoes", group: "carb", animal: "none", allergens: [] },
  { name: "Oats", group: "carb", animal: "none", allergens: ["gluten"] },
  { name: "Wholegrain bread", group: "carb", animal: "none", allergens: ["gluten"] },
  { name: "Pasta", group: "carb", animal: "none", allergens: ["gluten"] },
  { name: "Banana", group: "carb", animal: "none", allergens: [] },

  // Snacks
  { name: "Almonds", group: "snack", animal: "none", allergens: ["tree_nuts"] },
  { name: "Peanut butter", group: "snack", animal: "none", allergens: ["peanuts"] },
  { name: "Hummus", group: "snack", animal: "none", allergens: ["sesame"] },
  { name: "Rice cakes", group: "snack", animal: "none", allergens: [] },
  { name: "Roasted chickpeas", group: "snack", animal: "none", allergens: [] },
  { name: "Berries", group: "snack", animal: "none", allergens: [] },
  { name: "Cheese", group: "snack", animal: "animal_product", allergens: ["milk"] },
  { name: "Boiled eggs", group: "snack", animal: "animal_product", allergens: ["eggs"] },
  { name: "Protein bar", group: "snack", animal: "animal_product", allergens: ["milk", "soy"] },
];

// A small visual cue per catalog item — not literal icon art, just enough to
// make the "Food ideas" pills scannable at a glance instead of plain text.
export const FOOD_ITEM_EMOJI: Record<string, string> = {
  "Chicken breast": "🍗",
  "Lean beef": "🥩",
  Turkey: "🦃",
  Salmon: "🐟",
  Tuna: "🐟",
  Prawns: "🍤",
  Eggs: "🥚",
  "Greek yogurt": "🥣",
  "Cottage cheese": "🧀",
  "Whey protein": "🥤",
  Tofu: "🥡",
  Tempeh: "🫘",
  Lentils: "🍲",
  Chickpeas: "🫛",
  "Black beans": "🫘",
  "Pea protein": "🌱",
  "Brown rice": "🍚",
  "White rice": "🍚",
  Quinoa: "🌾",
  "Sweet potato": "🍠",
  Potatoes: "🥔",
  Oats: "🥣",
  "Wholegrain bread": "🍞",
  Pasta: "🍝",
  Banana: "🍌",
  Almonds: "🌰",
  "Peanut butter": "🥜",
  Hummus: "🫘",
  "Rice cakes": "🍘",
  "Roasted chickpeas": "🫛",
  Berries: "🫐",
  Cheese: "🧀",
  "Boiled eggs": "🥚",
  "Protein bar": "🍫",
};

// The allergen keys a member must never be shown, derived from their explicit
// allergies plus any intolerance/medical condition that implies an allergen.
export function excludedAllergensFor(profile: DietaryProfile): Set<string> {
  const excluded = new Set<string>(profile.allergies ?? []);
  for (const key of profile.intolerancesOrMedical ?? []) {
    for (const allergen of INTOLERANCE_TO_ALLERGENS[key] ?? []) {
      excluded.add(allergen);
    }
  }
  return excluded;
}

function allowedForPreference(animal: FoodAnimalClass, preference: DietaryPreference): boolean {
  switch (preference) {
    case "vegan":
      return animal === "none";
    case "vegetarian":
      return animal === "none" || animal === "animal_product";
    case "pescetarian":
      return animal !== "meat";
    case "standard":
    default:
      return true;
  }
}

// True only if the food violates NO hard exclusion AND fits the preference.
export function isFoodAllowed(item: FoodItem, profile: DietaryProfile): boolean {
  const preference = profile.dietaryPreference ?? "standard";
  if (!allowedForPreference(item.animal, preference)) return false;

  const excluded = excludedAllergensFor(profile);
  return !item.allergens.some((a) => excluded.has(a));
}

export interface FoodRecommendations {
  protein: FoodItem[];
  carb: FoodItem[];
  snack: FoodItem[];
}

// All allowed foods, grouped. Within a group, plant-based items are surfaced
// first for vegetarian/vegan members (preference as a ranking input); order is
// otherwise stable.
export function recommendFoods(profile: DietaryProfile): FoodRecommendations {
  const preference = profile.dietaryPreference ?? "standard";
  const plantFirst = preference === "vegan" || preference === "vegetarian";

  const allowed = FOOD_CATALOG.filter((item) => isFoodAllowed(item, profile));

  const forGroup = (group: FoodGroup) => {
    const items = allowed.filter((i) => i.group === group);
    if (!plantFirst) return items;
    return [...items].sort((a, b) => {
      const rank = (i: FoodItem) => (i.animal === "none" ? 0 : 1);
      return rank(a) - rank(b);
    });
  };

  return {
    protein: forGroup("protein"),
    carb: forGroup("carb"),
    snack: forGroup("snack"),
  };
}
