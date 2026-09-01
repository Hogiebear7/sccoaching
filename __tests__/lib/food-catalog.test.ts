import { describe, expect, it } from "vitest";

import type { FoodDomain, FoodEntryRecord, FoodRecord } from "@/lib/db";
import {
  applyCatalogMatches,
  gramsForServing,
  getFoodHistory,
  isBarcodeShaped,
  isBrandedRecordStale,
  isValidGtinChecksum,
  matchIdentifiedItemToCatalog,
  normalizeOffCountryTag,
  normalizeOpenFoodFactsProduct,
  nutritionForGrams,
  rankByTextMatch,
  scoreFoodMatch,
  searchFoodCatalog,
  stringSimilarity,
} from "@/lib/food-catalog";
import type { IdentifiedFoodItem } from "@/lib/ai";
import type { OpenFoodFactsProduct } from "@/lib/open-food-facts-client";

function makeFood(overrides: Partial<FoodRecord>): FoodRecord {
  return {
    id: "f1",
    domain: "common",
    name: "Banana",
    brandName: null,
    barcode: null,
    imageUrl: null,
    nutrition100g: { calories: 89, proteinG: 1.1, carbsG: 23, fatG: 0.3, fiberG: 2.6, sugarG: 12, sodiumMg: 1, saturatedFatG: 0.1 },
    defaultServing: { label: "1 medium (118g)", grams: 118 },
    servings: [{ label: "1 medium (118g)", grams: 118 }, { label: "100g", grams: 100 }],
    provenance: "usda_seed",
    sourceRef: null,
    verified: true,
    region: null,
    ownerUserId: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fetchedAt: null,
    ...overrides,
  };
}

describe("barcode validation", () => {
  it("recognizes barcode-shaped strings by digit-only length", () => {
    expect(isBarcodeShaped("12345678")).toBe(true); // EAN-8
    expect(isBarcodeShaped("123456789012")).toBe(true); // UPC-A
    expect(isBarcodeShaped("1234567890123")).toBe(true); // EAN-13
    expect(isBarcodeShaped("12345678901234")).toBe(true); // GTIN-14
    expect(isBarcodeShaped("1234567")).toBe(false); // wrong length
    expect(isBarcodeShaped("12345abc")).toBe(false); // not digits
  });

  it("validates a real GTIN mod-10 check digit and rejects a corrupted one", () => {
    // 5901234123457 is the standard EAN-13 checksum worked example.
    expect(isValidGtinChecksum("5901234123457")).toBe(true);
    expect(isValidGtinChecksum("5901234123458")).toBe(false);
    expect(isValidGtinChecksum("not-a-barcode")).toBe(false);
  });
});

describe("stringSimilarity", () => {
  it("is 1 for identical strings and tolerates small typos", () => {
    expect(stringSimilarity("banana", "banana")).toBe(1);
    expect(stringSimilarity("banana", "bananna")).toBeGreaterThan(0.8);
    expect(stringSimilarity("banana", "xyz")).toBeLessThan(0.3);
  });
});

describe("scoreFoodMatch", () => {
  it("ranks an exact barcode match above everything else", () => {
    const food = makeFood({ name: "Some Bar", barcode: "5901234123457" });
    expect(scoreFoodMatch("5901234123457", food)).toBe(1000);
  });

  it("ranks exact name > prefix > substring > typo-tolerant fuzzy", () => {
    const exact = scoreFoodMatch("banana", makeFood({ name: "Banana" }));
    const prefix = scoreFoodMatch("ban", makeFood({ name: "Banana" }));
    const substring = scoreFoodMatch("nana", makeFood({ name: "Banana" }));
    const fuzzy = scoreFoodMatch("bananna", makeFood({ name: "Banana" }));
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
  });

  it("excludes non-matches below the typo-tolerance threshold", () => {
    expect(scoreFoodMatch("zzz", makeFood({ name: "Banana" }))).toBe(0);
  });
});

describe("rankByTextMatch — country boost", () => {
  it("breaks a tie within the same relevance tier in favor of the member's country", () => {
    // Both are "contains" matches (score 200) for query "bar" — same tier.
    const irish = makeFood({ id: "ie", name: "Protein Bar", region: "IE" });
    const other = makeFood({ id: "us", name: "Protein Bar", region: "US" });
    const result = rankByTextMatch("bar", [other, irish], 10, "IE");
    expect(result.map((f) => f.id)).toEqual(["ie", "us"]);
  });

  it("never promotes a country match above a strictly better text match", () => {
    // "banana" startsWith "ban" (score 300) beats a country-matched
    // "cabana" that only contains "ban" (score 200 + 10 boost = 210).
    const startsWith = makeFood({ id: "sw", name: "Banana", region: "US" });
    const containsSameCountry = makeFood({ id: "cs", name: "Cabana Snack", region: "IE" });
    const result = rankByTextMatch("ban", [containsSameCountry, startsWith], 10, "IE");
    expect(result.map((f) => f.id)).toEqual(["sw", "cs"]);
  });

  it("is a no-op when the member has no country set or the food has no region", () => {
    const noRegion = makeFood({ id: "nr", name: "Protein Bar", region: null });
    expect(rankByTextMatch("bar", [noRegion], 10, "IE").map((f) => f.id)).toEqual(["nr"]);
    const withRegion = makeFood({ id: "wr", name: "Protein Bar", region: "IE" });
    expect(rankByTextMatch("bar", [withRegion], 10, null).map((f) => f.id)).toEqual(["wr"]);
  });

  it("never turns a non-match into a match", () => {
    const irishNonMatch = makeFood({ id: "ie", name: "Broccoli", region: "IE" });
    expect(rankByTextMatch("zzz", [irishNonMatch], 10, "IE")).toEqual([]);
  });
});

describe("normalizeOffCountryTag", () => {
  it("maps a known OFF country tag to its ISO alpha-2 code", () => {
    expect(normalizeOffCountryTag("en:ireland")).toBe("IE");
    expect(normalizeOffCountryTag("en:united-states")).toBe("US");
  });

  it("is case-insensitive on the tag", () => {
    expect(normalizeOffCountryTag("EN:IRELAND")).toBe("IE");
  });

  it("leaves an unmapped tag as-is rather than dropping it", () => {
    expect(normalizeOffCountryTag("en:atlantis")).toBe("en:atlantis");
  });

  it("returns null for a missing tag", () => {
    expect(normalizeOffCountryTag(undefined)).toBeNull();
    expect(normalizeOffCountryTag(null)).toBeNull();
  });
});

describe("getFoodHistory", () => {
  const banana = makeFood({ id: "banana", name: "Banana" });
  const apple = makeFood({ id: "apple", name: "Apple" });
  const resolveFood = (_domain: FoodDomain, id: string) => ({ banana, apple }[id]);

  function entry(overrides: Partial<FoodEntryRecord>): FoodEntryRecord {
    return {
      id: "e1",
      userId: "u1",
      date: "2026-08-01",
      mealType: "snack",
      name: "x",
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      createdAt: "2026-08-01T10:00:00.000Z",
      ...overrides,
    };
  }

  it("only surfaces entries with a resolvable foodId, most-recent first", () => {
    const entries = [
      entry({ id: "e1", foodId: "banana", foodDomain: "common", createdAt: "2026-08-01T10:00:00.000Z" }),
      entry({ id: "e2", foodId: "apple", foodDomain: "common", createdAt: "2026-08-02T10:00:00.000Z" }),
      entry({ id: "e3", name: "Freehand snack", createdAt: "2026-08-03T10:00:00.000Z" }), // no foodId — excluded
    ];
    const history = getFoodHistory(entries, resolveFood, "");
    expect(history.map((f) => f.id)).toEqual(["apple", "banana"]);
  });

  it("filters by query when provided", () => {
    const entries = [
      entry({ id: "e1", foodId: "banana", foodDomain: "common" }),
      entry({ id: "e2", foodId: "apple", foodDomain: "common" }),
    ];
    const history = getFoodHistory(entries, resolveFood, "ban");
    expect(history.map((f) => f.id)).toEqual(["banana"]);
  });
});

describe("searchFoodCatalog", () => {
  it("returns the four groups in the required shape, each independently ranked", () => {
    const custom = [makeFood({ id: "c1", domain: "custom", name: "My Protein Shake" })];
    const common = [makeFood({ id: "co1", domain: "common", name: "Banana" }), makeFood({ id: "co2", domain: "common", name: "Apple" })];
    const branded = [makeFood({ id: "b1", domain: "branded", name: "Quest Bar", brandName: "Quest" })];

    const result = searchFoodCatalog({
      query: "ban",
      userEntries: [],
      customFoods: custom,
      commonFoods: common,
      brandedFoods: branded,
      resolveFood: () => undefined,
    });

    expect(result.history).toEqual([]);
    expect(result.custom).toEqual([]);
    expect(result.common.map((f) => f.id)).toEqual(["co1"]);
    expect(result.branded).toEqual([]);
  });

  it("threads the country param through to branded ranking as a tie-breaker", () => {
    const branded = [
      makeFood({ id: "b-us", domain: "branded", name: "Protein Bar", brandName: "Acme", region: "US" }),
      makeFood({ id: "b-ie", domain: "branded", name: "Protein Bar", brandName: "Acme", region: "IE" }),
    ];

    const result = searchFoodCatalog({
      query: "protein bar",
      userEntries: [],
      customFoods: [],
      commonFoods: [],
      brandedFoods: branded,
      resolveFood: () => undefined,
      country: "IE",
    });

    expect(result.branded.map((f) => f.id)).toEqual(["b-ie", "b-us"]);
  });
});

describe("gramsForServing / nutritionForGrams", () => {
  it("resolves a named serving and scales nutrition from the per-100g basis", () => {
    const food = makeFood({});
    const grams = gramsForServing(food, "1 medium (118g)", 2);
    expect(grams).toBe(236);

    const nutrition = nutritionForGrams(food.nutrition100g, grams);
    expect(nutrition.calories).toBe(Math.round(89 * 2.36));
    expect(nutrition.proteinG).toBeCloseTo(1.1 * 2.36, 1);
  });

  it("falls back to the default serving when the label isn't found", () => {
    const food = makeFood({});
    expect(gramsForServing(food, "nonexistent", 1)).toBe(118);
  });
});

describe("normalizeOpenFoodFactsProduct", () => {
  it("maps a vendor payload into the internal FoodRecord shape", () => {
    const product: OpenFoodFactsProduct = {
      code: "5901234123457",
      product_name: "  Choc Bar  ",
      brands: "Acme, Other",
      serving_size: "40 g",
      countries_tags: ["en:united-states"],
      nutriments: {
        "energy-kcal_100g": 500,
        proteins_100g: 8,
        carbohydrates_100g: 55,
        fat_100g: 25,
        sodium_100g: 0.4,
      },
    };

    const food = normalizeOpenFoodFactsProduct(product, "5901234123457", "id-1", "2026-08-10T00:00:00.000Z");
    expect(food.domain).toBe("branded");
    expect(food.name).toBe("Choc Bar");
    expect(food.brandName).toBe("Acme");
    expect(food.barcode).toBe("5901234123457");
    expect(food.nutrition100g.calories).toBe(500);
    expect(food.nutrition100g.sodiumMg).toBe(400);
    expect(food.defaultServing).toEqual({ label: "40 g", grams: 40 });
    expect(food.provenance).toBe("open_food_facts");
    expect(food.verified).toBe(false);
  });

  it("falls back to a 100g serving when serving_size can't be parsed", () => {
    const product: OpenFoodFactsProduct = { product_name: "Mystery Item" };
    const food = normalizeOpenFoodFactsProduct(product, "12345678", "id-2", "2026-08-10T00:00:00.000Z");
    expect(food.defaultServing).toEqual({ label: "100g", grams: 100 });
    expect(food.nutrition100g.calories).toBe(0);
  });
});

describe("isBrandedRecordStale", () => {
  it("treats never-fetched records as stale and recent ones as fresh", () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    expect(isBrandedRecordStale(makeFood({ fetchedAt: null }), now)).toBe(true);
    expect(isBrandedRecordStale(makeFood({ fetchedAt: "2026-08-09T00:00:00.000Z" }), now)).toBe(false);
    expect(isBrandedRecordStale(makeFood({ fetchedAt: "2026-06-01T00:00:00.000Z" }), now)).toBe(true);
  });
});

describe("matchIdentifiedItemToCatalog", () => {
  const commonFoods = [makeFood({ id: "c1", domain: "common", name: "Grilled Chicken Breast" })];
  const brandedFoods = [
    makeFood({ id: "b1", domain: "branded", name: "Original", brandName: "Coca-Cola" }),
    makeFood({ id: "b2", domain: "branded", name: "Digestive Biscuits", brandName: "McVitie's", archivedAt: "2026-01-01T00:00:00.000Z" }),
  ];

  it("never matches a 'label' item — the AI already read real printed values, nothing to substitute", () => {
    const item: Pick<IdentifiedFoodItem, "name" | "source"> = { name: "Grilled Chicken Breast", source: "label" };
    expect(matchIdentifiedItemToCatalog(item, commonFoods, brandedFoods)).toBeNull();
  });

  it("matches an 'estimate' item by exact common-food name", () => {
    const item: Pick<IdentifiedFoodItem, "name" | "source"> = { name: "Grilled Chicken Breast", source: "estimate" };
    expect(matchIdentifiedItemToCatalog(item, commonFoods, brandedFoods)?.id).toBe("c1");
  });

  it("matches case/whitespace-insensitively", () => {
    const item: Pick<IdentifiedFoodItem, "name" | "source"> = { name: "  grilled   chicken breast  ", source: "estimate" };
    expect(matchIdentifiedItemToCatalog(item, commonFoods, brandedFoods)?.id).toBe("c1");
  });

  it("matches a branded item by its combined 'brand name' form", () => {
    const item: Pick<IdentifiedFoodItem, "name" | "source"> = { name: "Coca-Cola Original", source: "estimate" };
    expect(matchIdentifiedItemToCatalog(item, commonFoods, brandedFoods)?.id).toBe("b1");
  });

  it("does not match a merely similar name — exact match only, to avoid a confidently-wrong substitution", () => {
    const item: Pick<IdentifiedFoodItem, "name" | "source"> = { name: "Grilled Chicken Thigh", source: "estimate" };
    expect(matchIdentifiedItemToCatalog(item, commonFoods, brandedFoods)).toBeNull();
  });

  it("ignores archived records", () => {
    const item: Pick<IdentifiedFoodItem, "name" | "source"> = { name: "McVitie's Digestive Biscuits", source: "estimate" };
    expect(matchIdentifiedItemToCatalog(item, commonFoods, brandedFoods)).toBeNull();
  });
});

describe("applyCatalogMatches", () => {
  it("substitutes catalog nutrition/serving and relabels source to 'label' on a match", () => {
    const chicken = makeFood({
      id: "c1",
      domain: "common",
      name: "Grilled Chicken Breast",
      nutrition100g: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fiberG: 0, sugarG: 0, sodiumMg: 74, saturatedFatG: 1 },
      defaultServing: { label: "1 breast (172g)", grams: 172 },
    });
    const items: IdentifiedFoodItem[] = [
      { name: "Grilled Chicken Breast", servingDescription: "1 palm-sized portion (~150g)", calories: 250, proteinG: 40, carbsG: 0, fatG: 5, source: "estimate" },
    ];
    const [result] = applyCatalogMatches(items, [chicken], []);
    expect(result.source).toBe("label");
    expect(result.servingDescription).toBe("1 breast (172g)");
    expect(result.calories).toBe(Math.round((165 * 172) / 100));
  });

  it("leaves a 'label' item and a non-matching 'estimate' item untouched", () => {
    const chicken = makeFood({ id: "c1", domain: "common", name: "Grilled Chicken Breast" });
    const items: IdentifiedFoodItem[] = [
      { name: "Nutrition Facts Panel Item", servingDescription: "1 serving (40g)", calories: 200, proteinG: 5, carbsG: 20, fatG: 8, source: "label" },
      { name: "Homemade Lasagna", servingDescription: "1 slice (~250g)", calories: 400, proteinG: 20, carbsG: 30, fatG: 18, source: "estimate" },
    ];
    const result = applyCatalogMatches(items, [chicken], []);
    expect(result).toEqual(items);
  });
});
