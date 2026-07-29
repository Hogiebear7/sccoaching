import { describe, expect, it } from "vitest";

import {
  excludedAllergensFor,
  FOOD_CATALOG,
  isFoodAllowed,
  recommendFoods,
  type DietaryProfile,
} from "@/lib/nutrition-recommendations";

const allNames = (r: ReturnType<typeof recommendFoods>) =>
  [...r.protein, ...r.carb, ...r.snack].map((i) => i.name);

describe("excludedAllergensFor", () => {
  it("combines explicit allergies with intolerance-implied allergens", () => {
    const set = excludedAllergensFor({
      allergies: ["peanuts"],
      intolerancesOrMedical: ["coeliac", "lactose_intolerant"],
    });
    expect(set.has("peanuts")).toBe(true);
    expect(set.has("gluten")).toBe(true); // coeliac → gluten
    expect(set.has("milk")).toBe(true); // lactose intolerant → milk
  });
});

describe("recommendFoods — hard exclusions (allergies)", () => {
  it("NEVER returns a food containing an excluded allergen", () => {
    const profile: DietaryProfile = {
      dietaryPreference: "standard",
      allergies: ["fish", "shellfish", "milk", "soy", "tree_nuts", "peanuts", "sesame", "eggs"],
      intolerancesOrMedical: [],
    };
    const rec = recommendFoods(profile);
    const excluded = excludedAllergensFor(profile);
    for (const item of [...rec.protein, ...rec.carb, ...rec.snack]) {
      expect(item.allergens.some((a) => excluded.has(a))).toBe(false);
    }
    // Salmon (fish), Prawns (shellfish), Greek yogurt (milk), Almonds (tree nuts)
    // must all be gone.
    expect(allNames(rec)).not.toContain("Salmon");
    expect(allNames(rec)).not.toContain("Prawns");
    expect(allNames(rec)).not.toContain("Greek yogurt");
    expect(allNames(rec)).not.toContain("Almonds");
    expect(allNames(rec)).not.toContain("Peanut butter");
  });

  it("coeliac excludes every gluten food; lactose intolerant excludes dairy", () => {
    const rec = recommendFoods({
      dietaryPreference: "standard",
      allergies: [],
      intolerancesOrMedical: ["coeliac", "lactose_intolerant"],
    });
    const names = allNames(rec);
    // gluten carbs gone
    expect(names).not.toContain("Oats");
    expect(names).not.toContain("Wholegrain bread");
    expect(names).not.toContain("Pasta");
    // dairy gone
    expect(names).not.toContain("Greek yogurt");
    expect(names).not.toContain("Cheese");
    expect(names).not.toContain("Whey protein");
    // gluten-free carbs remain
    expect(names).toContain("Brown rice");
    expect(names).toContain("Quinoa");
  });
});

describe("recommendFoods — dietary preference filter", () => {
  it("vegan returns only plant-based foods", () => {
    const rec = recommendFoods({ dietaryPreference: "vegan", allergies: [], intolerancesOrMedical: [] });
    for (const item of [...rec.protein, ...rec.carb, ...rec.snack]) {
      expect(item.animal).toBe("none");
    }
    expect(allNames(rec)).toContain("Tofu");
    expect(allNames(rec)).not.toContain("Chicken breast");
    expect(allNames(rec)).not.toContain("Salmon");
    expect(allNames(rec)).not.toContain("Eggs");
  });

  it("vegetarian excludes meat and fish but allows dairy/eggs", () => {
    const rec = recommendFoods({ dietaryPreference: "vegetarian", allergies: [], intolerancesOrMedical: [] });
    const names = allNames(rec);
    expect(names).not.toContain("Chicken breast");
    expect(names).not.toContain("Salmon");
    expect(names).toContain("Eggs");
    expect(names).toContain("Greek yogurt");
  });

  it("pescetarian allows fish/seafood but not meat", () => {
    const rec = recommendFoods({ dietaryPreference: "pescetarian", allergies: [], intolerancesOrMedical: [] });
    const names = allNames(rec);
    expect(names).toContain("Salmon");
    expect(names).toContain("Prawns");
    expect(names).not.toContain("Chicken breast");
    expect(names).not.toContain("Lean beef");
  });

  it("standard allows everything (subject only to allergies)", () => {
    const rec = recommendFoods({ dietaryPreference: "standard", allergies: [], intolerancesOrMedical: [] });
    expect(allNames(rec)).toContain("Chicken breast");
    expect(allNames(rec)).toContain("Salmon");
    expect(allNames(rec)).toContain("Tofu");
  });
});

describe("recommendFoods — combined preference + allergy", () => {
  it("vegan + soy allergy excludes tofu/tempeh but keeps beans/lentils", () => {
    const rec = recommendFoods({
      dietaryPreference: "vegan",
      allergies: ["soy"],
      intolerancesOrMedical: [],
    });
    const names = allNames(rec);
    expect(names).not.toContain("Tofu");
    expect(names).not.toContain("Tempeh");
    expect(names).toContain("Lentils");
    expect(names).toContain("Chickpeas");
  });
});

describe("empty / backward-compatible profile", () => {
  it("undefined dietary fields behave as standard with no exclusions", () => {
    const rec = recommendFoods({});
    expect(allNames(rec).length).toBe(FOOD_CATALOG.length);
  });
});

describe("isFoodAllowed", () => {
  it("agrees with recommendFoods for a sample item", () => {
    const salmon = FOOD_CATALOG.find((f) => f.name === "Salmon")!;
    expect(isFoodAllowed(salmon, { dietaryPreference: "pescetarian" })).toBe(true);
    expect(isFoodAllowed(salmon, { dietaryPreference: "vegetarian" })).toBe(false);
    expect(isFoodAllowed(salmon, { allergies: ["fish"] })).toBe(false);
  });
});
