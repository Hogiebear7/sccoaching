import { describe, expect, it } from "vitest";

import { parseMealSuggestions } from "@/lib/ai";

const base = { title: "Egg wrap", description: "Eggs in a wrap.", ingredientsUsed: ["eggs", "wrap"], estimatedCalories: 420, estimatedProteinG: 24, estimatedCarbsG: 30, estimatedFatG: 22 };

describe("parseMealSuggestions: fibre and sugar estimates", () => {
  it("keeps fibre and sugar to one decimal place", () => {
    const [s] = parseMealSuggestions(JSON.stringify([{ ...base, estimatedFiberG: 4.26, estimatedSugarG: 3 }]));
    expect(s.estimatedFiberG).toBe(4.3);
    expect(s.estimatedSugarG).toBe(3);
  });

  it("leaves them null when the model omits them or gives nonsense, never a made-up zero", () => {
    const [s] = parseMealSuggestions(JSON.stringify([{ ...base }]));
    expect(s.estimatedFiberG).toBeNull();
    expect(s.estimatedSugarG).toBeNull();
    const [t] = parseMealSuggestions(JSON.stringify([{ ...base, estimatedFiberG: "lots", estimatedSugarG: -4 }]));
    expect(t.estimatedFiberG).toBeNull();
    expect(t.estimatedSugarG).toBeNull();
  });

  it("a genuine zero is kept", () => {
    const [s] = parseMealSuggestions(JSON.stringify([{ ...base, estimatedFiberG: 0, estimatedSugarG: 0 }]));
    expect(s.estimatedFiberG).toBe(0);
    expect(s.estimatedSugarG).toBe(0);
  });

  it("still returns the four macros as before", () => {
    const [s] = parseMealSuggestions(JSON.stringify([base]));
    expect(s).toMatchObject({ estimatedCalories: 420, estimatedProteinG: 24, estimatedCarbsG: 30, estimatedFatG: 22 });
  });
});
