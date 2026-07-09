import { describe, expect, it } from "vitest";

import {
  buildDrinkMix,
  buildDrinkPlan,
  drinkDurationInfo,
  drinkWorkload,
  exertionFromDayLoad,
  fuelBandForLoad,
  goalBiasFromPrimaryGoal,
  macroTargets,
  weightedThreeDayLoad,
} from "@/lib/nutrition";

describe("weightedThreeDayLoad", () => {
  it("weights today 0.5, tomorrow 0.3, yesterday 0.2 (calculator sheet)", () => {
    // Medium yesterday (2), High today (3), Match tomorrow (4):
    // 2*0.2 + 3*0.5 + 4*0.3 = 0.4 + 1.5 + 1.2 = 3.1
    expect(weightedThreeDayLoad("medium", "high", "match")).toBe(3.1);
  });

  it("all-low week floors at 1.0", () => {
    expect(weightedThreeDayLoad("low", "low", "low")).toBe(1);
  });
});

describe("exertionFromDayLoad", () => {
  it("maps logged duration×RPE onto the exertion scale", () => {
    expect(exertionFromDayLoad(0)).toBe("low"); // rest day
    expect(exertionFromDayLoad(270)).toBe("medium"); // 45 min @ RPE 6
    expect(exertionFromDayLoad(420)).toBe("high"); // 60 min @ RPE 7
    expect(exertionFromDayLoad(540)).toBe("match"); // 60 min @ RPE 9
  });
});

describe("fuelBandForLoad", () => {
  it("uses the sheet's band boundaries", () => {
    expect(fuelBandForLoad(1.0).day).toBe("reduced");
    expect(fuelBandForLoad(1.5).day).toBe("reduced");
    expect(fuelBandForLoad(2.2).day).toBe("standard");
    expect(fuelBandForLoad(3.0).day).toBe("full");
    expect(fuelBandForLoad(3.1).day).toBe("match");
  });

  it("carbs vary across bands while protein and fat stay comparatively stable", () => {
    const reduced = fuelBandForLoad(1.0);
    const match = fuelBandForLoad(4.0);
    expect(match.carbGkg - reduced.carbGkg).toBe(3); // 4 → 7 g/kg
    expect(Math.abs(match.proteinGkg - reduced.proteinGkg)).toBeCloseTo(0.4, 5);
    expect(Math.abs(match.fatGkg - reduced.fatGkg)).toBeCloseTo(0.2, 5);
  });
});

describe("macroTargets", () => {
  it("computes g/kg and total grams/day for the body weight", () => {
    const band = fuelBandForLoad(2.0); // standard: 5 / 1.6 / 0.8
    const macros = macroTargets(80, band);
    expect(macros.carbGkg).toBe(5);
    expect(macros.carbGramsDay).toBe(400);
    expect(macros.proteinGramsDay).toBe(128);
    expect(macros.fatGramsDay).toBe(64);
  });

  it("applies the capped carb bias for cut and gain goals", () => {
    const band = fuelBandForLoad(2.0);
    expect(macroTargets(80, band, "lose").carbGkg).toBe(4.7);
    expect(macroTargets(80, band, "gain").carbGkg).toBe(5.3);
  });

  it("maps the app's primary goals onto the bias", () => {
    expect(goalBiasFromPrimaryGoal("Weight Loss")).toBe("lose");
    expect(goalBiasFromPrimaryGoal("Build Muscle")).toBe("gain");
    expect(goalBiasFromPrimaryGoal("General Health")).toBe("maintain");
  });
});

describe("buildDrinkMix", () => {
  const base = {
    bodyWeightKg: 75,
    bottleMl: 1000,
    sweat: "medium" as const,
    temp: "cool" as const,
    sport: "soccer" as const,
    role: "cm",
    durationIdx: 1, // 90 min, factor 1.0
    runKm: 10,
    runEffort: "steady" as const,
  };

  it("reproduces the calculator sheet for the default 75 kg centre mid, 1 L, 90 min", () => {
    const mix = buildDrinkMix(base);
    expect(mix.maltodextrinG).toBe(30); // 75 × 0.4
    expect(mix.betaAlanineG).toBe(1.6); // 60–85 kg band
    expect(mix.chiaG).toBe(5);
    expect(mix.beetrootG).toBe(8); // centre mid
    expect(mix.orangeMl).toBe(20);
    expect(mix.sodiumFromSaltMg).toBe(400); // medium × cool × 1.0
    expect(mix.saltG).toBe(1.02); // 400 / 393
    expect(mix.sodiumFromOrangeMg).toBe(8);
    expect(mix.sodiumTotalMg).toBe(408);
    expect(mix.carbsG).toBe(30.5); // 30×0.95 + 20×0.1
    expect(mix.nitrateMg).toBe(400); // 8 g × 50
    expect(mix.calories).toBe(128); // 30×4 + 20×0.4
    expect(mix.sodiumBadge).toBe("optimal");
  });

  it("scales every ingredient with bottle volume", () => {
    const half = buildDrinkMix({ ...base, bottleMl: 500 });
    expect(half.maltodextrinG).toBe(15);
    expect(half.chiaG).toBe(2.5);
    expect(half.orangeMl).toBe(10);
    expect(half.sodiumFromSaltMg).toBe(200);
  });

  it("raises sodium for high sweat / hot conditions and long matches", () => {
    const hot = buildDrinkMix({ ...base, sweat: "high", temp: "hot", durationIdx: 2 });
    expect(hot.sodiumFromSaltMg).toBe(1170); // 900 × 1.3
    expect(hot.sodiumBadge).toBe("high");

    const short = buildDrinkMix({ ...base, durationIdx: 0 });
    expect(short.sodiumFromSaltMg).toBe(280); // 400 × 0.7
  });

  it("adjusts beetroot by role and beta-alanine by body weight", () => {
    expect(buildDrinkMix({ ...base, role: "gk" }).beetrootG).toBe(5);
    expect(buildDrinkMix({ ...base, role: "wm" }).beetrootG).toBe(8);
    expect(buildDrinkMix({ ...base, bodyWeightKg: 55 }).betaAlanineG).toBe(1.2);
    expect(buildDrinkMix({ ...base, bodyWeightKg: 90 }).betaAlanineG).toBe(2);
  });

  it("applies per-sport duration factors and role beet doses", () => {
    // Gaelic full match: 70 min band, factor 0.8 → 400 × 0.8 = 320
    const gaelic = buildDrinkMix({ ...base, sport: "gaelic", role: "mid", durationIdx: 1 });
    expect(gaelic.sodiumFromSaltMg).toBe(320);
    expect(gaelic.beetrootG).toBe(8); // midfield

    // Rugby full match: 80 min band, factor 0.9 → 360; tight five beet 5
    const rugby = buildDrinkMix({ ...base, sport: "rugby", role: "tight", durationIdx: 1 });
    expect(rugby.sodiumFromSaltMg).toBe(360);
    expect(rugby.beetrootG).toBe(5);

    // Hockey match (4×15): factor 0.75 → 300
    const hockey = buildDrinkMix({ ...base, sport: "hockey", role: "fwd", durationIdx: 1 });
    expect(hockey.sodiumFromSaltMg).toBe(300);
    expect(hockey.beetrootG).toBe(7);
  });

  it("derives run duration from distance × effort and clamps the factor", () => {
    // 10 km steady: 55 min → factor 55/90
    const run10 = buildDrinkMix({ ...base, sport: "run", runKm: 10, runEffort: "steady" });
    expect(drinkDurationInfo({ ...base, sport: "run", runKm: 10, runEffort: "steady" }).mins).toBe(55);
    expect(run10.sodiumFromSaltMg).toBe(Math.round((400 * (55 / 90)) / 10) * 10);
    expect(run10.beetrootG).toBe(6); // 8–15 km band

    // Marathon hard: factor clamps at 1.8 → 400 × 1.8 = 720
    const marathon = buildDrinkMix({ ...base, sport: "run", runKm: 42, runEffort: "hard" });
    expect(marathon.sodiumFromSaltMg).toBe(720);
    expect(marathon.beetrootG).toBe(8);

    // Short easy jog: factor floors at 0.6 → 240; short-run beet dose 5
    const jog = buildDrinkMix({ ...base, sport: "run", runKm: 3, runEffort: "easy" });
    expect(jog.sodiumFromSaltMg).toBe(240);
    expect(jog.beetrootG).toBe(5);
  });

  it("describes the workload from the role, or the run itself", () => {
    expect(drinkWorkload({ ...base, sport: "rugby", role: "back3" }).dist).toBe("~7–8 km");
    expect(drinkWorkload({ ...base, sport: "run", runKm: 21 }).dist).toBe("21 km");
  });

  it("accepts fractional run distances", () => {
    // Half marathon at steady pace: 21.1 × 5.5 = 116.05 → rounded to 115 min
    expect(drinkDurationInfo({ ...base, sport: "run", runKm: 21.1, runEffort: "steady" }).mins).toBe(115);
  });
});

describe("buildDrinkPlan", () => {
  const base = {
    bodyWeightKg: 75,
    bottleMl: 1000,
    sweat: "medium" as const,
    temp: "cool" as const,
    sport: "soccer" as const,
    role: "cm",
    durationIdx: 1,
    runKm: 10,
    runEffort: "steady" as const,
  };

  it("splits the bottle across four match phases", () => {
    const plan = buildDrinkPlan(base);
    expect(plan.phases.map((p) => p.label)).toEqual([
      "Pre-match",
      "First half",
      "Half-time",
      "Second half",
    ]);
    // 28/18/28/26% of 1000 ml
    expect(plan.phases.map((p) => p.amount)).toEqual(["280 ml", "180 ml", "280 ml", "260 ml"]);
    expect(plan.bottleAdvice).toContain("1000 ml");
    expect(plan.extra).toBeNull();
  });

  it("uses hockey's quarter-based phase labels", () => {
    const plan = buildDrinkPlan({ ...base, sport: "hockey", role: "mid", durationIdx: 1 });
    expect(plan.phases[2].label).toBe("Quarter & half breaks");
  });

  it("advises a second bottle for hot or extended sessions", () => {
    expect(buildDrinkPlan({ ...base, temp: "hot" }).extra).toMatch(/second bottle/i);
    expect(buildDrinkPlan({ ...base, durationIdx: 2 }).extra).toMatch(/second bottle/i); // 120 min
  });

  it("recommends a smaller bottle for 60-min training", () => {
    const plan = buildDrinkPlan({ ...base, durationIdx: 0, bottleMl: 750 });
    expect(plan.bottleAdvice).toContain("750 ml");
  });

  it("says no carried drink is needed for a short run", () => {
    const plan = buildDrinkPlan({ ...base, sport: "run", runKm: 3, runEffort: "easy" }); // 20 min
    expect(plan.bottleAdvice).toMatch(/no carried drink/i);
    expect(plan.phases[1].amount).toBe("Optional");
  });

  it("scales in-run fluid with duration and recommends carry sizes", () => {
    // 10 km steady = 55 min, cool/medium rate 500 ml/h → ~450 ml → soft flask
    const mid = buildDrinkPlan({ ...base, sport: "run", runKm: 10, runEffort: "steady" });
    expect(mid.bottleAdvice).toMatch(/soft flask/i);
    expect(mid.phases[1].amount).toBe("350–550 ml");

    // Marathon at hard effort = 200 min → vest / refill territory
    const long = buildDrinkPlan({ ...base, sport: "run", runKm: 42.2, runEffort: "hard" });
    expect(long.bottleAdvice).toMatch(/vest|refill/i);
  });

  it("adds a plain-water note for hot runs", () => {
    const plan = buildDrinkPlan({ ...base, sport: "run", runKm: 10, temp: "hot" });
    expect(plan.extra).toMatch(/plain water/i);
  });
});
