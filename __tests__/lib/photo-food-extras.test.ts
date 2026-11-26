import { describe, expect, it } from "vitest";

import { parseIdentifiedFoodItems } from "@/lib/ai";
import type { FoodRecord } from "@/lib/db";
import { applyCatalogMatches } from "@/lib/food-catalog";
import { applyFoodIdentificationOverrides } from "@/lib/food-identification-override";

const base = { name: "Banana", servingDescription: "1 medium (118g)", calories: 105, proteinG: 1, carbsG: 27, fatG: 0, source: "estimate" };

describe("parseIdentifiedFoodItems: fibre, sugars, sodium, saturated fat", () => {
  it("keeps sensible numbers (one decimal for grams, whole mg for sodium)", () => {
    const [i] = parseIdentifiedFoodItems(JSON.stringify([{ ...base, source: "label", fiberG: 3.14, sugarG: 14.4, sodiumMg: 1.2, saturatedFatG: 0.1 }]));
    expect(i).toMatchObject({ fiberG: 3.1, sugarG: 14.4, sodiumMg: 1, saturatedFatG: 0.1, source: "label" });
  });

  it("is null when missing, negative or absurd, never a made-up zero", () => {
    const [a] = parseIdentifiedFoodItems(JSON.stringify([base]));
    expect([a.fiberG, a.sugarG, a.sodiumMg, a.saturatedFatG]).toEqual([null, null, null, null]);
    const [b] = parseIdentifiedFoodItems(JSON.stringify([{ ...base, fiberG: -2, sugarG: "lots", sodiumMg: 9e9, saturatedFatG: null }]));
    expect([b.fiberG, b.sugarG, b.sodiumMg, b.saturatedFatG]).toEqual([null, null, null, null]);
  });

  it("keeps a genuine zero", () => {
    const [i] = parseIdentifiedFoodItems(JSON.stringify([{ ...base, fiberG: 0, sugarG: 0 }]));
    expect(i.fiberG).toBe(0);
    expect(i.sugarG).toBe(0);
  });
});

describe("catalogue matches carry the catalogue's own extras", () => {
  const food = {
    id: "f1",
    domain: "common",
    name: "Banana",
    brandName: null,
    archivedAt: null,
    nutrition100g: { calories: 89, proteinG: 1.1, carbsG: 23, fatG: 0.3, fiberG: 2.6, sugarG: 12, sodiumMg: null, saturatedFatG: 0.1 },
    defaultServing: { label: "1 medium (118g)", grams: 118 },
    servings: [],
  } as unknown as FoodRecord;

  it("replaces the AI's guess with the catalogue values for the serving, and null where the catalogue has none", () => {
    const [m] = applyCatalogMatches([{ ...base, fiberG: 9, sugarG: 99, sodiumMg: 500, saturatedFatG: 5, source: "estimate" as const }], [food], []);
    expect(m.source).toBe("label");
    expect(m.fiberG).toBe(3.1);
    expect(m.sugarG).toBe(14.2);
    expect(m.sodiumMg).toBeNull();
    expect(m.saturatedFatG).toBe(0.1);
  });

  it("leaves an unmatched item's own extras alone", () => {
    const [m] = applyCatalogMatches([{ ...base, name: "Mystery stew", fiberG: 4, source: "estimate" as const }], [food], []);
    expect(m.fiberG).toBe(4);
  });
});

describe("a saved correction drops the extras that belonged to the original read", () => {
  it("nulls them when an override swaps the numbers in", () => {
    const [m] = applyFoodIdentificationOverrides(
      [{ ...base, fiberG: 3, sugarG: 14, source: "estimate" as const }],
      [{ triggerLabel: "banana", preferredFood: { name: "Big banana", servingDescription: "1 large", calories: 130, proteinG: 1, carbsG: 33, fatG: 0 } } as never]
    );
    expect(m.overridden).toBe(true);
    expect([m.fiberG, m.sugarG, m.sodiumMg, m.saturatedFatG]).toEqual([null, null, null, null]);
  });
});
