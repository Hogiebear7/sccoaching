// The advice shown for each stage: trimesters, the 12 weeks after the birth,
// and breastfeeding for as long as it continues.
import { describe, expect, it } from "vitest";

import { estimatePregnancy } from "@/lib/pregnancy";

const DUE = "2027-05-20"; // pregnancy starts 2026-08-13

describe("estimatePregnancy advice", () => {
  it("gives the first-trimester supplements and food safety list", () => {
    const e = estimatePregnancy(true, DUE, "2026-10-26");
    expect(e).toMatchObject({ trimester: 1, weeksPregnant: 10 });
    expect(e.content?.nutritionDo.join(" ")).toMatch(/400 µg of folic acid/);
    expect(e.content?.nutritionDo.join(" ")).toMatch(/10 µg of vitamin D/);
    expect(e.content?.nutritionAvoid.join(" ")).toMatch(/Alcohol/);
  });

  it("uses the HSE calorie figures", () => {
    expect(estimatePregnancy(true, DUE, "2027-01-10").content?.summary).toMatch(/250 extra calories/);
    expect(estimatePregnancy(true, DUE, "2027-03-15").content?.summary).toMatch(/500 extra calories/);
  });

  it("switches to after-birth advice at the birth date and ends it after 12 weeks", () => {
    const born = { birthDate: "2027-05-10", breastfeeding: false };
    expect(estimatePregnancy(true, DUE, "2027-05-12", born)).toMatchObject({ trimester: "postpartum", content: { label: "After the birth" } });
    expect(estimatePregnancy(true, DUE, "2027-09-01", born).content).toBeNull();
  });

  it("keeps breastfeeding advice going past 12 weeks while breastfeeding", () => {
    const feeding = { birthDate: "2027-05-10", breastfeeding: true };
    expect(estimatePregnancy(true, DUE, "2027-05-20", feeding).content?.label).toBe("Breastfeeding");
    expect(estimatePregnancy(true, DUE, "2027-12-01", feeding).content?.label).toBe("Breastfeeding");
    expect(estimatePregnancy(true, DUE, "2027-12-01", feeding).content?.summary).toMatch(/Let the app know when you stop/);
  });

  it("shows nothing when not pregnant", () => {
    expect(estimatePregnancy(false, null).content).toBeNull();
  });
});
