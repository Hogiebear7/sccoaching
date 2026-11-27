import { describe, expect, it } from "vitest";

import { MICRONUTRIENTS, MICRO_KEYS, coverageText, formatMicro, hasAnyMicros, parseMicros, parseWaterG, scaleMicros, sumMicros } from "@/lib/micronutrients";

describe("the tracked list", () => {
  it("is the fifteen nutrients the owner chose, each with a unit", () => {
    expect(MICRO_KEYS).toHaveLength(15);
    expect(MICRONUTRIENTS.map((d) => d.label)).toEqual([
      "Iron", "Calcium", "Magnesium", "Potassium", "Zinc", "Iodine", "Selenium", "Vitamin A", "Vitamin C", "Vitamin D", "Vitamin E", "Vitamin K", "Vitamin B12", "Folate", "Omega-3",
    ]);
    expect(new Set(MICRONUTRIENTS.map((d) => d.key)).size).toBe(15);
  });
});

describe("parseMicros", () => {
  it("keeps known keys with sane numbers, rounds to the nutrient's precision, and drops everything else", () => {
    const out = parseMicros({ ironMg: 2.456, calciumMg: 120.4, vitaminCMg: -1, zincMg: "3", bogus: 5, folateUg: Number.NaN, vitaminDUg: 99999, omega3G: 0 });
    expect(out).toEqual({ ironMg: 2.46, calciumMg: 120, omega3G: 0 });
  });

  it("an unlisted nutrient is absent, never zero; a real zero is kept", () => {
    const out = parseMicros({ ironMg: 0 });
    expect(out.ironMg).toBe(0);
    expect("calciumMg" in out).toBe(false);
  });

  it("copes with junk input", () => {
    expect(parseMicros(null)).toEqual({});
    expect(parseMicros("iron")).toEqual({});
    expect(parseMicros([1, 2])).toEqual({});
  });
});

describe("parseWaterG", () => {
  it("is a number or null", () => {
    expect(parseWaterG(87.34)).toBe(87.3);
    expect(parseWaterG(-1)).toBeNull();
    expect(parseWaterG("80")).toBeNull();
  });
});

describe("scaleMicros", () => {
  it("scales per-100 g values to an amount and leaves unknown unknown", () => {
    expect(scaleMicros({ ironMg: 2, vitaminCMg: 10 }, 1.5)).toEqual({ ironMg: 3, vitaminCMg: 15 });
    expect(scaleMicros({ ironMg: 2 }, 2)).not.toHaveProperty("zincMg");
    expect(scaleMicros(undefined, 2)).toEqual({});
    expect(scaleMicros({ ironMg: 2 }, -1)).toEqual({});
  });
});

describe("sumMicros: unknown is never zero", () => {
  const entries = [{ micros: { ironMg: 2, calciumMg: 100 } }, { micros: { ironMg: 1.5 } }, {}, { micros: null }];
  const by = Object.fromEntries(sumMicros(entries).map((t) => [t.key, t]));

  it("adds only entries that list a nutrient and counts coverage", () => {
    expect(by.ironMg).toMatchObject({ total: 3.5, listedBy: 2, entryCount: 4, atLeast: true });
    expect(by.calciumMg).toMatchObject({ total: 100, listedBy: 1, atLeast: true });
  });

  it("a nutrient nobody lists has no data rather than a total of zero", () => {
    expect(by.zincMg).toMatchObject({ total: 0, listedBy: 0, atLeast: true });
    expect(formatMicro(by.zincMg)).toBe("No data");
  });

  it("is not 'at least' when every entry lists it", () => {
    const all = sumMicros([{ micros: { ironMg: 1 } }, { micros: { ironMg: 2 } }]).find((t) => t.key === "ironMg")!;
    expect(all.atLeast).toBe(false);
    expect(formatMicro(all)).toBe("3 mg");
  });

  it("formats and describes coverage in plain words", () => {
    expect(formatMicro(by.ironMg)).toBe("at least 3.5 mg");
    expect(coverageText(by.ironMg)).toBe("2 of 4 foods list this");
    expect(coverageText({ listedBy: 0, entryCount: 3 })).toBe("None of 3 foods list this");
    expect(coverageText({ listedBy: 3, entryCount: 3 })).toBe("All 3 foods list this");
    expect(coverageText({ listedBy: 0, entryCount: 0 })).toBe("No foods logged yet");
  });
});

describe("hasAnyMicros", () => {
  it("is true only when at least one value is known", () => {
    expect(hasAnyMicros({})).toBe(false);
    expect(hasAnyMicros(undefined)).toBe(false);
    expect(hasAnyMicros({ omega3G: 0 })).toBe(true);
  });
});
