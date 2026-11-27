import { describe, expect, it } from "vitest";

import { bestMatch, confidence, nameScore, parseCofidValue } from "../../scripts/lib/cofid.mjs";

describe("reading a CoFID cell", () => {
  it("blank and N are unknown, never zero; Tr is a trace (0); brackets are an estimate", () => {
    expect(parseCofidValue(null)).toBeUndefined();
    expect(parseCofidValue("")).toBeUndefined();
    expect(parseCofidValue("N")).toBeUndefined();
    expect(parseCofidValue("Tr")).toBe(0);
    expect(parseCofidValue("(0.5)")).toBe(0.5);
    expect(parseCofidValue("0.70")).toBe(0.7);
    expect(parseCofidValue(12)).toBe(12);
    expect(parseCofidValue("abc")).toBeUndefined();
    expect(parseCofidValue(-3)).toBeUndefined();
  });
});

describe("matching by name", () => {
  it("every one of our words must be in theirs; cooked is met by any cooking word", () => {
    expect(nameScore("Chicken Breast, Cooked", "Chicken, breast, grilled, meat only")).toBeGreaterThan(0.6);
    expect(nameScore("Chicken Breast, Cooked", "Chicken, breast, raw")).toBe(0);
    expect(nameScore("Spinach, Raw", "Spinach, mature, raw")).toBeGreaterThan(0.6);
    expect(nameScore("Banana", "Bananas, flesh only")).toBeGreaterThan(0.6);
    expect(nameScore("Oats, Dry", "Porridge, made with water")).toBe(0);
  });
  it("fewer extra words scores higher", () => {
    expect(nameScore("Egg, Whole", "Eggs, whole, boiled")).toBeGreaterThan(nameScore("Egg, Whole", "Eggs, whole, boiled, from hens fed omega-3 enriched feed, with salt"));
  });
});

describe("how sure a match is", () => {
  const cofid = { kcal: 173, proteinG: 28.9 };
  it("high needs the name AND the energy and protein to agree", () => {
    expect(confidence({ calories: 165, proteinG: 31 }, cofid, 0.9)).toBe("high");
    expect(confidence({ calories: 300, proteinG: 31 }, cofid, 0.9)).toBe("review");
    expect(confidence({ calories: 165, proteinG: 10 }, cofid, 0.9)).toBe("review");
    expect(confidence({ calories: 165, proteinG: 31 }, cofid, 0.3)).toBe("review");
  });
  it("picks the name match closest in energy and protein", () => {
    const foods = [
      { code: "a", name: "Rice, white, boiled", kcal: 131, proteinG: 2.8, micros: {} },
      { code: "b", name: "Rice, white, boiled, in salted water, with butter", kcal: 180, proteinG: 2.5, micros: {} },
    ];
    expect(bestMatch({ name: "White Rice, Cooked", calories: 130, proteinG: 2.7 }, foods)?.food.code).toBe("a");
    expect(bestMatch({ name: "Whey Protein Powder", calories: 400, proteinG: 80 }, foods)).toBeNull();
  });
});
