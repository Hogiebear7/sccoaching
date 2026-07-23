import { describe, expect, it } from "vitest";

import {
  categoryFromPriceCents,
  describePackageAllowance,
  formatBillingOptionCadence,
  slugifyCatalog,
} from "@/lib/catalog";
import type {
  MembershipBillingOptionRecord,
  MembershipCategoryRecord,
  MembershipPackageRecord,
} from "@/lib/db";

function cat(id: string, visible = true): MembershipCategoryRecord {
  return { id, name: id, slug: id, description: null, sortOrder: 0, visible, createdAt: "x", updatedAt: "x" };
}
function pkg(id: string, categoryId: string, visible = true): MembershipPackageRecord {
  return {
    id, categoryId, name: id, slug: id, shortDescription: null, fullDescription: null,
    packageType: "membership", sessionAllowanceType: "fixed_count", sessionAllowanceCount: 8,
    eligibleClassTypes: [], visible, sortOrder: 0, stripeProductId: null, createdAt: "x", updatedAt: "x",
  };
}
function opt(id: string, packageId: string, amountCents: number, visible = true): MembershipBillingOptionRecord {
  return {
    id, packageId, name: id, billingType: "recurring", intervalUnit: "month", intervalCount: 1,
    amountCents, currency: "eur", visible, sortOrder: 0, stripePriceId: null, createdAt: "x", updatedAt: "x",
  };
}

describe("categoryFromPriceCents", () => {
  const category = cat("c1");
  const packages = [pkg("p1", "c1"), pkg("p2", "c1"), pkg("hidden", "c1", false), pkg("other", "c2")];

  it("returns the cheapest VISIBLE option across VISIBLE packages", () => {
    const options = [
      opt("o1", "p1", 25000),
      opt("o2", "p2", 12000),
      opt("cheapHidden", "p1", 5000, false), // hidden option — ignored
      opt("onHiddenPkg", "hidden", 1000), // on a hidden package — ignored
      opt("otherCat", "other", 500), // different category — ignored
    ];
    expect(categoryFromPriceCents(category, packages, options)).toBe(12000);
  });

  it("returns null when the category has nothing sellable", () => {
    expect(categoryFromPriceCents(category, packages, [])).toBeNull();
  });
});

describe("formatBillingOptionCadence", () => {
  it("labels each cadence", () => {
    expect(formatBillingOptionCadence(opt("a", "p", 100))).toBe("/ month");
    expect(formatBillingOptionCadence({ ...opt("a", "p", 100), intervalCount: 3 })).toBe("/ quarter");
    expect(formatBillingOptionCadence({ ...opt("a", "p", 100), intervalUnit: "year", intervalCount: 1 })).toBe("/ year");
    expect(
      formatBillingOptionCadence({ ...opt("a", "p", 100), billingType: "one_time", intervalUnit: null, intervalCount: null })
    ).toBe("one-time");
  });
});

describe("describePackageAllowance", () => {
  it("describes each allowance type", () => {
    expect(describePackageAllowance(pkg("p", "c"))).toBe("8 sessions");
    expect(describePackageAllowance({ ...pkg("p", "c"), sessionAllowanceType: "unlimited", sessionAllowanceCount: null })).toBe("Unlimited sessions");
    expect(describePackageAllowance({ ...pkg("p", "c"), sessionAllowanceType: "single_use", sessionAllowanceCount: 1 })).toBe("Single class pass");
  });
});

describe("slugifyCatalog", () => {
  it("makes a stable underscore slug", () => {
    expect(slugifyCatalog("Semi-Private PT")).toBe("semi_private_pt");
    expect(slugifyCatalog("  Parent & Baby  ")).toBe("parent_baby");
  });
});
