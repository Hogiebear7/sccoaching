import { describe, expect, it } from "vitest";

import {
  categoryFromPrice,
  describePackageAllowance,
  formatBillingOptionCadence,
  memberBillingHint,
  memberBillingLabel,
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

function oneTime(id: string, packageId: string, amountCents: number, visible = true): MembershipBillingOptionRecord {
  return { ...opt(id, packageId, amountCents, visible), billingType: "one_time", intervalUnit: null, intervalCount: null };
}

describe("categoryFromPrice", () => {
  const category = cat("c1");
  const packages = [pkg("p1", "c1"), pkg("p2", "c1"), pkg("hidden", "c1", false), pkg("other", "c2")];

  it("prefers the cheapest VISIBLE RECURRING option and never lets a one-off undercut it", () => {
    const options = [
      opt("o1", "p1", 25000), // recurring
      opt("o2", "p2", 12000), // recurring (cheapest recurring)
      oneTime("cheapPass", "p1", 3500), // one-off, cheaper — must NOT win
      opt("cheapHidden", "p1", 5000, false), // hidden — ignored
      opt("onHiddenPkg", "hidden", 1000), // hidden package — ignored
      opt("otherCat", "other", 500), // different category — ignored
    ];
    expect(categoryFromPrice(category, packages, options)).toEqual({ amountCents: 12000, billingType: "recurring" });
  });

  it("falls back to the cheapest one-time option only when there are no recurring options", () => {
    const options = [oneTime("t1", "p1", 6000), oneTime("t2", "p2", 4000)];
    expect(categoryFromPrice(category, packages, options)).toEqual({ amountCents: 4000, billingType: "one_time" });
  });

  it("returns null when the category has nothing sellable", () => {
    expect(categoryFromPrice(category, packages, [])).toBeNull();
  });
});

describe("formatBillingOptionCadence", () => {
  it("labels each recurring cadence and drops the suffix for one-off", () => {
    expect(formatBillingOptionCadence(opt("a", "p", 100))).toBe("/ month");
    expect(formatBillingOptionCadence({ ...opt("a", "p", 100), intervalCount: 3 })).toBe("/ quarter");
    expect(formatBillingOptionCadence({ ...opt("a", "p", 100), intervalUnit: "year", intervalCount: 1 })).toBe("/ year");
    expect(
      formatBillingOptionCadence({ ...opt("a", "p", 100), billingType: "one_time", intervalUnit: null, intervalCount: null })
    ).toBe("");
  });
});

describe("memberBillingLabel", () => {
  it("reads as a membership for recurring and a one-off otherwise — no jargon", () => {
    expect(memberBillingLabel(opt("a", "p", 100))).toBe("Monthly membership");
    expect(memberBillingLabel({ ...opt("a", "p", 100), intervalCount: 3 })).toBe("Quarterly membership");
    expect(memberBillingLabel({ ...opt("a", "p", 100), intervalUnit: "year", intervalCount: 1 })).toBe("Annual membership");
    expect(memberBillingLabel({ ...opt("a", "p", 100), billingType: "one_time", intervalUnit: null, intervalCount: null })).toBe("One-off purchase");
  });
});

describe("memberBillingHint", () => {
  it("reassures on renewal for recurring and says nothing renews for one-off", () => {
    expect(memberBillingHint(opt("a", "p", 100))).toContain("Renews automatically every month");
    expect(memberBillingHint({ ...opt("a", "p", 100), intervalCount: 3 })).toContain("every 3 months");
    expect(memberBillingHint({ ...opt("a", "p", 100), billingType: "one_time", intervalUnit: null, intervalCount: null })).toContain("nothing renews");
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
