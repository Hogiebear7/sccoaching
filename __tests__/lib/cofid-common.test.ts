import { describe, expect, it } from "vitest";

import { buildCommonFood, exclusionReason, readCofidFoods, uniqueNames } from "../../scripts/lib/cofid-common.mjs";

// A tiny workbook in CoFID's layout: row 0 long names, row 1 short codes, row 2 descriptions, data from row 3.
function sheet(name: string, shortCodes: string[], rows: unknown[][]) {
  const head = ["Food Code", "Food Name", "Description", "Group", "Previous", "Refs", "Footnote"];
  const pad = [null, null, null, null, null, null, null];
  return { sheet: name, data: [[...head, ...shortCodes], [...pad, ...shortCodes], [...pad, ...shortCodes], ...rows] };
}
const base = (code: string, name: string, group: string) => [code, name, "", group, null, "", null];

function workbook() {
  return [
    sheet("1.3 Proximates", ["WATER", "PROT", "FAT", "CHO", "KCALS", "TOTSUG", "AOACFIB", "SATFOD", "TOTn3PFOD", "ALCO"], [
      [...base("11-1", "Oats, rolled, raw", "AA"), "8", "11", "9", "60", "370", "1", "10", "1.5", "N", "0"],
      [...base("12-1", "Infant formula, powder", "BF"), "3", "11", "26", "55", "500", "5", "0", "10", "0", "0"],
      [...base("13-1", "Lager beer", "QA"), "92", "0.3", "0", "2", "30", "0", "0", "0", "0", "4"],
      [...base("14-1", "Mystery food", "DG"), "50", "N", "1", "2", "20", "0", "0", "0", "0", "0"],
    ]),
    sheet("1.4 Inorganics", ["NA", "K", "CA", "MG", "P", "FE", "CU", "ZN", "CL", "MN", "SE", "I"], [
      [...base("11-1", "Oats, rolled, raw", "AA"), "5", "350", "52", "110", "400", "3.8", "0.4", "3.2", "1", "4", "Tr", "N"],
      [...base("12-1", "Infant formula, powder", "BF"), "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      [...base("13-1", "Lager beer", "QA"), "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      [...base("14-1", "Mystery food", "DG"), "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
    ]),
    sheet("1.5 Vitamins", ["RET", "RETEQU", "VITD", "VITE", "VITK1", "VITC", "VITB12", "FOLT"], [
      [...base("11-1", "Oats, rolled, raw", "AA"), "0", "0", "0", "1.5", "N", "0", "0", "60"],
      [...base("12-1", "Infant formula, powder", "BF"), "1", "1", "1", "1", "1", "1", "1", "1"],
      [...base("13-1", "Lager beer", "QA"), "0", "0", "0", "0", "0", "0", "0", "0"],
      [...base("14-1", "Mystery food", "DG"), "0", "0", "0", "0", "0", "0", "0", "0"],
    ]),
  ];
}

describe("reading CoFID foods", () => {
  const foods = readCofidFoods(workbook());
  const oats = foods.find((f) => f.code === "11-1")!;

  it("reads the main figures, sodium and the vitamins and minerals", () => {
    expect(oats.name).toBe("Oats, rolled, raw");
    expect(oats).toMatchObject({ kcal: 370, proteinG: 11, carbsG: 60, fatG: 9, sugarG: 1, fiberG: 10, saturatedFatG: 1.5, waterG: 8, sodiumMg: 5 });
    expect(oats.micros).toMatchObject({ ironMg: 3.8, calciumMg: 52, folateUg: 60, vitaminEMg: 1.5 });
  });

  it("keeps unknown as unknown (never zero) and a trace as zero", () => {
    expect(oats.micros.seleniumUg).toBe(0); // "Tr"
    expect("iodineUg" in oats.micros).toBe(false); // "N"
    expect("vitaminKUg" in oats.micros).toBe(false); // "N"
    expect("omega3G" in oats.micros).toBe(false); // "N"
  });
});

describe("which foods are left out", () => {
  const foods = readCofidFoods(workbook());
  const reason = (code: string) => exclusionReason(foods.find((f) => f.code === code)!);

  it("adds an everyday food", () => expect(reason("11-1")).toBeNull());
  it("leaves out infant foods", () => expect(reason("12-1")).toBe("infant food or formula"));
  it("leaves out alcoholic drinks", () => expect(reason("13-1")).toMatch(/alcoholic/));
  it("leaves out a food with a missing main figure", () => expect(reason("14-1")).toMatch(/missing/));
  it("leaves out figures that cannot be right", () => {
    expect(exclusionReason({ name: "X", group: "DG", kcal: 400, proteinG: 60, carbsG: 60, fatG: 20 })).toBe("figures do not add up");
    expect(exclusionReason({ name: "X", group: "DG", kcal: 2000, proteinG: 1, carbsG: 1, fatG: 1 })).toBe("energy figure not plausible");
  });
});

describe("names and records", () => {
  it("gives a repeated or already-present name its code in brackets", () => {
    const names = uniqueNames([{ code: "1", name: "Rice" }, { code: "2", name: "Rice" }, { code: "3", name: "Egg" }], new Set(["egg"]));
    expect(names.get("1")).toBe("Rice");
    expect(names.get("2")).toBe("Rice (2)");
    expect(names.get("3")).toBe("Egg (3)");
  });

  it("builds a record that only carries what CoFID gives", () => {
    const oats = readCofidFoods(workbook()).find((f) => f.code === "11-1")!;
    const record = buildCommonFood(oats, "Oats, rolled, raw");
    expect(record).toMatchObject({ domain: "common", provenance: "cofid", sourceRef: "cofid:11-1", microsSource: "CoFID 2021, food 11-1", verified: true, brandName: null });
    expect(record.nutrition100g.calories).toBe(370);
    expect(record.nutrition100g.micros).not.toHaveProperty("iodineUg");
    expect(record.defaultServing).toEqual({ label: "100g", grams: 100 });
  });
});
