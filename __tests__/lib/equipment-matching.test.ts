import { describe, expect, it } from "vitest";

import {
  equipmentMatchesQuery,
  equipmentSlugMatchesVendorString,
  exerciseMatchesEquipmentSlugs,
  vendorStringsForSlug,
} from "@/lib/equipment-matching";

describe("equipmentSlugMatchesVendorString", () => {
  it("matches the canonical label case-insensitively", () => {
    expect(equipmentSlugMatchesVendorString("barbell", "Barbell")).toBe(true);
    expect(equipmentSlugMatchesVendorString("barbell", "barbell")).toBe(true);
  });

  it("matches via aliases (vendor free-text values)", () => {
    expect(equipmentSlugMatchesVendorString("bodyweight-only", "body weight")).toBe(true);
    expect(equipmentSlugMatchesVendorString("cable-machine", "cable")).toBe(true);
    expect(equipmentSlugMatchesVendorString("leg-press", "leverage machine")).toBe(true);
  });

  it("does not match an unrelated string or an unknown slug", () => {
    expect(equipmentSlugMatchesVendorString("barbell", "dumbbell")).toBe(false);
    expect(equipmentSlugMatchesVendorString("not-a-real-slug", "barbell")).toBe(false);
  });
});

describe("exerciseMatchesEquipmentSlugs", () => {
  it("always includes exercises with no equipment listed (bodyweight)", () => {
    expect(exerciseMatchesEquipmentSlugs(null, ["barbell"])).toBe(true);
    expect(exerciseMatchesEquipmentSlugs("", ["barbell"])).toBe(true);
  });

  it("includes everything when no equipment is selected", () => {
    expect(exerciseMatchesEquipmentSlugs("barbell", [])).toBe(true);
  });

  it("includes an exercise whose vendor equipment matches a selected slug", () => {
    expect(exerciseMatchesEquipmentSlugs("dumbbell", ["dumbbells", "kettlebells"])).toBe(true);
  });

  it("excludes an exercise whose vendor equipment matches nothing selected", () => {
    expect(exerciseMatchesEquipmentSlugs("barbell", ["dumbbells", "kettlebells"])).toBe(false);
  });
});

describe("equipmentMatchesQuery", () => {
  it("matches on label and on alias substrings", () => {
    expect(equipmentMatchesQuery("air-bike", "assault")).toBe(true);
    expect(equipmentMatchesQuery("air-bike", "air")).toBe(true);
    expect(equipmentMatchesQuery("dumbbells", "db")).toBe(true);
  });

  it("returns true for an empty query and false for no match", () => {
    expect(equipmentMatchesQuery("barbell", "")).toBe(true);
    expect(equipmentMatchesQuery("barbell", "kettlebell")).toBe(false);
  });
});

describe("vendorStringsForSlug", () => {
  it("returns the distinct raw vendor strings that resolve to a slug", () => {
    const result = vendorStringsForSlug("barbell", ["Barbell", "barbell", "olympic barbell", "dumbbell"]);
    expect(result.sort()).toEqual(["Barbell", "barbell", "olympic barbell"].sort());
  });
});
