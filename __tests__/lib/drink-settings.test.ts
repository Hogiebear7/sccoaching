import { describe, expect, it } from "vitest";

import {
  DEFAULT_DRINK_SETTINGS,
  describeDrinkSettings,
  normalizeDrinkSettings,
  parseDrinkSettingsJson,
} from "@/lib/drink-settings";

const VALID = {
  sport: "rugby",
  role: "tight",
  durationIdx: 2,
  runKm: 21.1,
  runEffort: "hard",
  bottleMl: 750,
  sweat: "high",
  temp: "warm",
};

describe("normalizeDrinkSettings", () => {
  it("passes valid settings through unchanged", () => {
    expect(normalizeDrinkSettings(VALID)).toEqual(VALID);
  });

  it("returns defaults for non-object input", () => {
    expect(normalizeDrinkSettings(null)).toEqual(DEFAULT_DRINK_SETTINGS);
    expect(normalizeDrinkSettings("x")).toEqual(DEFAULT_DRINK_SETTINGS);
    expect(normalizeDrinkSettings(42)).toEqual(DEFAULT_DRINK_SETTINGS);
  });

  it("falls back to the default sport for unknown sports", () => {
    const result = normalizeDrinkSettings({ ...VALID, sport: "cricket" });
    expect(result.sport).toBe("soccer");
  });

  it("resolves an invalid role against the sport's default", () => {
    // "cm" is a soccer role, not a rugby one
    expect(normalizeDrinkSettings({ ...VALID, role: "cm" }).role).toBe("backrow");
  });

  it("rejects an out-of-range duration index", () => {
    expect(normalizeDrinkSettings({ ...VALID, durationIdx: 9 }).durationIdx).toBe(1); // rugby default
    expect(normalizeDrinkSettings({ ...VALID, durationIdx: -1 }).durationIdx).toBe(1);
    expect(normalizeDrinkSettings({ ...VALID, durationIdx: 1.5 }).durationIdx).toBe(1);
  });

  it("clamps and rounds run distance, keeping decimals", () => {
    expect(normalizeDrinkSettings({ ...VALID, runKm: 21.14 }).runKm).toBe(21.1);
    expect(normalizeDrinkSettings({ ...VALID, runKm: 900 }).runKm).toBe(10); // out of range → default
    expect(normalizeDrinkSettings({ ...VALID, runKm: "10k" }).runKm).toBe(10);
  });

  it("only accepts known bottle sizes and enum values", () => {
    expect(normalizeDrinkSettings({ ...VALID, bottleMl: 640 }).bottleMl).toBe(1000);
    expect(normalizeDrinkSettings({ ...VALID, sweat: "soaked" }).sweat).toBe("medium");
    expect(normalizeDrinkSettings({ ...VALID, temp: "freezing" }).temp).toBe("cool");
    expect(normalizeDrinkSettings({ ...VALID, runEffort: "sprint" }).runEffort).toBe("steady");
  });
});

describe("parseDrinkSettingsJson", () => {
  it("round-trips serialized settings", () => {
    expect(parseDrinkSettingsJson(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("returns null for missing, malformed, or non-object JSON", () => {
    expect(parseDrinkSettingsJson(null)).toBeNull();
    expect(parseDrinkSettingsJson("")).toBeNull();
    expect(parseDrinkSettingsJson("{not json")).toBeNull();
    expect(parseDrinkSettingsJson('"a string"')).toBeNull();
    expect(parseDrinkSettingsJson("123")).toBeNull();
  });

  it("normalizes partially corrupted stored settings", () => {
    const stored = JSON.stringify({ sport: "run", runKm: 42.2, bottleMl: "big" });
    expect(parseDrinkSettingsJson(stored)).toEqual({
      ...DEFAULT_DRINK_SETTINGS,
      sport: "run",
      role: "",
      durationIdx: 0,
      runKm: 42.2,
    });
  });
});

describe("describeDrinkSettings", () => {
  it("shows sport and bottle for team sports", () => {
    expect(describeDrinkSettings({ ...DEFAULT_DRINK_SETTINGS, sport: "rugby", role: "tight", bottleMl: 750 })).toBe(
      "Rugby · 750 ml"
    );
  });

  it("shows distance for runs and flags notable conditions", () => {
    expect(
      describeDrinkSettings({
        ...DEFAULT_DRINK_SETTINGS,
        sport: "run",
        role: "",
        runKm: 21.1,
        temp: "hot",
      })
    ).toBe("Run · 21.1 km · Hot");
    expect(
      describeDrinkSettings({ ...DEFAULT_DRINK_SETTINGS, sport: "soccer", temp: "warm" })
    ).toBe("Soccer · 1000 ml · Warm");
  });

  it("omits cool conditions as the unremarkable default", () => {
    expect(describeDrinkSettings(DEFAULT_DRINK_SETTINGS)).toBe("Soccer · 1000 ml");
  });
});
