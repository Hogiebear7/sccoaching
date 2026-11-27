import { describe, expect, it } from "vitest";

import { MICRO_KEYS } from "@/lib/micronutrients";
import { ageInYears, MICRO_REFERENCES, referenceShare, resolveReference } from "@/lib/micronutrient-references";

const now = new Date("2026-11-27T12:00:00Z");
const adultM = { gender: "Male", dateOfBirth: "1990-05-01" };
const adultF = { gender: "Female", dateOfBirth: "1990-05-01" };

describe("EFSA reference amounts (copied from the 2017 summary tables)", () => {
  it("adult men and women, straight from the tables", () => {
    const m = (k: string) => resolveReference(k as never, adultM, now)?.amount;
    const f = (k: string) => resolveReference(k as never, adultF, now)?.amount;
    expect([m("ironMg"), f("ironMg")]).toEqual([11, 16]);
    expect([m("calciumMg"), f("calciumMg")]).toEqual([950, 950]);
    expect([m("magnesiumMg"), f("magnesiumMg")]).toEqual([350, 300]);
    expect([m("potassiumMg"), f("potassiumMg")]).toEqual([3500, 3500]);
    expect([m("iodineUg"), f("iodineUg")]).toEqual([150, 150]);
    expect([m("seleniumUg"), f("seleniumUg")]).toEqual([70, 70]);
    expect([m("vitaminAUg"), f("vitaminAUg")]).toEqual([750, 650]);
    expect([m("vitaminCMg"), f("vitaminCMg")]).toEqual([110, 95]);
    expect([m("vitaminDUg"), f("vitaminDUg")]).toEqual([15, 15]);
    expect([m("vitaminEMg"), f("vitaminEMg")]).toEqual([13, 11]);
    expect([m("vitaminKUg"), f("vitaminKUg")]).toEqual([70, 70]);
    expect([m("vitaminB12Ug"), f("vitaminB12Ug")]).toEqual([4, 4]);
    expect([m("folateUg"), f("folateUg")]).toEqual([330, 330]);
    expect([m("zincMg"), f("zincMg")]).toEqual([11.7, 9.3]);
  });
  it("says whether each is a PRI or an AI", () => {
    expect(resolveReference("ironMg", adultM, now)?.kind).toBe("PRI");
    expect(resolveReference("magnesiumMg", adultM, now)?.kind).toBe("AI");
  });
  it("pregnancy and breastfeeding differ where EFSA says they do", () => {
    const preg = { ...adultF, isPregnant: true };
    const bf = { ...adultF, breastfeeding: true };
    expect(resolveReference("folateUg", preg, now)?.amount).toBe(600);
    expect(resolveReference("iodineUg", preg, now)?.amount).toBe(200);
    expect(resolveReference("vitaminAUg", bf, now)?.amount).toBe(1300);
    expect(resolveReference("potassiumMg", bf, now)?.amount).toBe(4000);
    expect(resolveReference("seleniumUg", bf, now)?.amount).toBe(85);
    expect(resolveReference("ironMg", { ...adultF, isPregnant: true }, now)?.amount).toBe(16);
    expect(resolveReference("zincMg", preg, now)?.amount).toBe(10.9); // 9.3 + 1.6
    expect(resolveReference("zincMg", bf, now)?.amount).toBe(12.2); // 9.3 + 2.9
  });
  it("women after the menopause need less iron", () => {
    expect(resolveReference("ironMg", { ...adultF, menopauseStage: "postmenopause" }, now)?.amount).toBe(11);
    expect(resolveReference("ironMg", { ...adultF, menopauseStage: "perimenopause" }, now)?.amount).toBe(16);
  });
  it("someone who did not say male or female sees the higher figure, and is told", () => {
    const r = resolveReference("ironMg", { gender: "Other", dateOfBirth: "1990-01-01" }, now);
    expect(r?.amount).toBe(16);
    expect(r?.text).toMatch(/higher one is shown/);
    expect(resolveReference("magnesiumMg", { dateOfBirth: "1990-01-01" }, now)?.amount).toBe(350);
  });
  it("a young adult gets 1,000 mg calcium; under 18 gets nothing", () => {
    expect(resolveReference("calciumMg", { gender: "Male", dateOfBirth: "2005-01-01" }, now)?.amount).toBe(1000);
    expect(resolveReference("ironMg", { gender: "Male", dateOfBirth: "2012-01-01" }, now)).toBeNull();
  });
  it("omega-3 has an explanation and no single amount", () => {
    const r = resolveReference("omega3G", adultM, now);
    expect(r?.amount).toBeNull();
    expect(r?.text).toMatch(/EPA plus DHA/);
  });
  it("has a figure for every tracked nutrient except omega-3", () => {
    for (const key of MICRO_KEYS) if (key !== "omega3G") expect(MICRO_REFERENCES[key]).toBeDefined();
  });
  it("age and share maths", () => {
    expect(ageInYears("2000-12-01", now)).toBe(25);
    expect(ageInYears("2000-11-27", now)).toBe(26);
    expect(ageInYears(null, now)).toBeNull();
    expect(referenceShare(475, { amount: 950 })).toBe(0.5);
    expect(referenceShare(5, { amount: null })).toBeNull();
  });
});
