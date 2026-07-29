import { describe, expect, it } from "vitest";

import { sanitizeDietaryFields } from "@/lib/profile-options";

describe("sanitizeDietaryFields", () => {
  it("defaults an unknown/empty preference to standard", () => {
    expect(sanitizeDietaryFields({}).dietaryPreference).toBe("standard");
    expect(sanitizeDietaryFields({ dietaryPreference: "carnivore" }).dietaryPreference).toBe("standard");
  });

  it("keeps a valid preference", () => {
    expect(sanitizeDietaryFields({ dietaryPreference: "vegan" }).dietaryPreference).toBe("vegan");
  });

  it("filters allergy/intolerance lists to known keys and de-dupes", () => {
    const out = sanitizeDietaryFields({
      allergies: ["peanuts", "peanuts", "unicorn", "milk", 42],
      intolerancesOrMedical: ["coeliac", "made_up"],
    });
    expect(out.allergies.sort()).toEqual(["milk", "peanuts"]);
    expect(out.intolerancesOrMedical).toEqual(["coeliac"]);
  });

  it("trims notes to a string or null", () => {
    expect(sanitizeDietaryFields({ dietaryNotes: "  no pork  " }).dietaryNotes).toBe("no pork");
    expect(sanitizeDietaryFields({ dietaryNotes: "   " }).dietaryNotes).toBeNull();
    expect(sanitizeDietaryFields({ dietaryNotes: 5 }).dietaryNotes).toBeNull();
  });

  it("treats non-array lists as empty", () => {
    const out = sanitizeDietaryFields({ allergies: "peanuts", intolerancesOrMedical: null });
    expect(out.allergies).toEqual([]);
    expect(out.intolerancesOrMedical).toEqual([]);
  });
});
