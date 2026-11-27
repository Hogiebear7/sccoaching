import { describe, expect, it } from "vitest";

import { describeOffer, emptyOffer, offerOptionPayload, offerPackagePayload, validateOffer, type OfferInput } from "@/lib/catalog-offer";

const o = (patch: Partial<OfferInput>): OfferInput => ({ ...emptyOffer(patch.kind ?? "membership"), name: "Test", priceEur: "50", ...patch });

describe("validateOffer", () => {
  it("needs a name, a price, and a class count where one applies", () => {
    expect(validateOffer(o({ name: " " }))).toMatch(/name/);
    expect(validateOffer(o({ priceEur: "" }))).toMatch(/price/);
    expect(validateOffer(o({ priceEur: "-5" }))).toMatch(/price/);
    expect(validateOffer(o({ priceEur: "0.2" }))).toMatch(/0\.50/);
    expect(validateOffer(o({ kind: "class_pack", classCount: "" }))).toMatch(/classes/);
    expect(validateOffer(o({ kind: "class_pack", classCount: "2.5" }))).toMatch(/classes/);
    expect(validateOffer(o({ kind: "membership", unlimited: true }))).toBeNull();
    expect(validateOffer(o({ kind: "single_class" }))).toBeNull();
    expect(validateOffer(o({ kind: "trial_pass", classCount: "3" }))).toBeNull();
    expect(validateOffer(o({ priceEur: "0" }))).toBeNull(); // a free offer is allowed
  });
});

describe("what gets created", () => {
  it("a monthly unlimited membership is a recurring membership package with a monthly option", () => {
    const i = o({ kind: "membership", unlimited: true, priceEur: "79" });
    expect(offerPackagePayload(i, "cat1")).toMatchObject({ categoryId: "cat1", packageType: "membership", sessionAllowanceType: "unlimited", sessionAllowanceCount: null, accessType: "membership", introOnly: false });
    expect(offerOptionPayload(i, "pkg1")).toMatchObject({ packageId: "pkg1", billingType: "recurring", intervalUnit: "month", intervalCount: 1, priceEur: "79.00", name: "Monthly" });
  });

  it("a yearly or 3-monthly membership gets the right cadence, and a set number of classes a period", () => {
    expect(offerOptionPayload(o({ renews: "annual" }), "p")).toMatchObject({ intervalUnit: "year", intervalCount: 1, name: "Yearly" });
    expect(offerOptionPayload(o({ renews: "quarterly" }), "p")).toMatchObject({ intervalUnit: "month", intervalCount: 3 });
    expect(offerPackagePayload(o({ unlimited: false, classCount: "8" }), "c")).toMatchObject({ sessionAllowanceType: "fixed_count", sessionAllowanceCount: 8 });
  });

  it("a class pack is a one-off pass with a fixed number of classes", () => {
    const i = o({ kind: "class_pack", classCount: "10", priceEur: "120" });
    expect(offerPackagePayload(i, "c")).toMatchObject({ packageType: "pass", sessionAllowanceType: "fixed_count", sessionAllowanceCount: 10, accessType: "pass", introOnly: false });
    expect(offerOptionPayload(i, "p")).toMatchObject({ billingType: "one_time", intervalUnit: null, intervalCount: null, name: "One-off payment" });
  });

  it("a trial pass is a one-off pass flagged as the trial pass", () => {
    expect(offerPackagePayload(o({ kind: "trial_pass", classCount: "3" }), "c")).toMatchObject({ packageType: "pass", introOnly: true, sessionAllowanceCount: 3 });
  });

  it("a single class is single use", () => {
    expect(offerPackagePayload(o({ kind: "single_class" }), "c")).toMatchObject({ packageType: "pass", sessionAllowanceType: "single_use", introOnly: false });
  });

  it("carries visibility, class types and the description", () => {
    const p = offerPackagePayload(o({ visible: false, eligibleSlugs: ["strength"], description: " Hi " }), "c");
    expect(p).toMatchObject({ visible: false, eligibleClassTypes: ["strength"], shortDescription: "Hi" });
  });
});

describe("describeOffer", () => {
  it("says what members get and pay in one sentence", () => {
    expect(describeOffer(o({ kind: "membership", unlimited: true, priceEur: "79" }))).toBe("Members pay €79 every month for unlimited classes, until they cancel. Members can see and buy it.");
    expect(describeOffer(o({ kind: "class_pack", classCount: "10", priceEur: "49.5", visible: false }))).toBe("Members pay €49.50 once for 10 classes. Hidden from members until you show it.");
    expect(describeOffer(o({ kind: "trial_pass", classCount: "3", priceEur: "50" }))).toMatch(/New members pay €50 once for 3 classes.*once.*before they have a membership/);
    expect(describeOffer(o({ kind: "single_class", priceEur: "15" }))).toMatch(/€15 once for 1 class/);
  });

  it("names the class types when some are chosen", () => {
    expect(describeOffer(o({ kind: "class_pack", classCount: "5", eligibleSlugs: ["a"] }), ["Over 50s"])).toMatch(/\(Over 50s only\)/);
  });
});
