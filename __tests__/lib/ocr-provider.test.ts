import { describe, expect, it } from "vitest";

import { parseNutritionLabelText } from "@/lib/ocr-provider";

describe("parseNutritionLabelText", () => {
  it("extracts nutrition-fact fields and serving size from typical label text", () => {
    const text = `
      Nutrition Facts
      Serving Size 1 bar (40g)
      Calories 180
      Total Fat 7g
      Saturated Fat 2g
      Sodium 95mg
      Total Carbohydrate 22g
      Dietary Fiber 3g
      Sugars 9g
      Protein 10g
    `;

    const fields = parseNutritionLabelText(text);
    expect(fields).toMatchObject({
      calories: 180,
      fatG: 7,
      saturatedFatG: 2,
      sodiumMg: 95,
      carbsG: 22,
      fiberG: 3,
      sugarG: 9,
      proteinG: 10,
      servingGrams: 40,
    });
    expect(fields.servingLabel).toContain("1 bar");
  });

  it("leaves fields null when the pattern isn't found rather than guessing", () => {
    const fields = parseNutritionLabelText("some unrelated text with no nutrition data");
    expect(fields.calories).toBeNull();
    expect(fields.proteinG).toBeNull();
    expect(fields.servingLabel).toBeNull();
  });
});
