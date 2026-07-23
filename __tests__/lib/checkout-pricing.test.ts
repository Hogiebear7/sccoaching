import { describe, expect, it } from "vitest";

import { resolveCheckoutLineItem } from "@/lib/billing";
import type { MembershipBillingOptionRecord } from "@/lib/db";

function opt(overrides: Partial<MembershipBillingOptionRecord>): MembershipBillingOptionRecord {
  return {
    id: "o1", packageId: "p1", name: "Monthly",
    billingType: "recurring", intervalUnit: "month", intervalCount: 1,
    amountCents: 25000, currency: "eur", visible: true, sortOrder: 0,
    stripePriceId: null, createdAt: "x", updatedAt: "x",
    ...overrides,
  };
}

describe("resolveCheckoutLineItem", () => {
  it("uses a stored Stripe price id when present (preferred path)", () => {
    const r = resolveCheckoutLineItem({ option: opt({ stripePriceId: "price_123" }), productName: "X" });
    expect(r.usedPriceId).toBe(true);
    expect(r.mode).toBe("subscription");
    expect(r.lineItemParams).toEqual({ "line_items[0][price]": "price_123", "line_items[0][quantity]": "1" });
  });

  it("falls back to inline recurring price_data with interval_count", () => {
    const r = resolveCheckoutLineItem({ option: opt({ intervalCount: 3 }), productName: "Unlimited" });
    expect(r.usedPriceId).toBe(false);
    expect(r.mode).toBe("subscription");
    expect(r.lineItemParams["line_items[0][price_data][unit_amount]"]).toBe("25000");
    expect(r.lineItemParams["line_items[0][price_data][recurring][interval]"]).toBe("month");
    expect(r.lineItemParams["line_items[0][price_data][recurring][interval_count]"]).toBe("3");
    expect(r.lineItemParams["line_items[0][price_data][currency]"]).toBe("eur");
  });

  it("one-time options use payment mode and carry no recurring block", () => {
    const r = resolveCheckoutLineItem({
      option: opt({ billingType: "one_time", intervalUnit: null, intervalCount: null, amountCents: 3500 }),
      productName: "One Class Pass",
    });
    expect(r.mode).toBe("payment");
    expect(r.usedPriceId).toBe(false);
    expect(r.lineItemParams["line_items[0][price_data][unit_amount]"]).toBe("3500");
    expect(r.lineItemParams["line_items[0][price_data][recurring][interval]"]).toBeUndefined();
  });

  it("annual recurring maps to the year interval", () => {
    const r = resolveCheckoutLineItem({ option: opt({ intervalUnit: "year", intervalCount: 1 }), productName: "X" });
    expect(r.lineItemParams["line_items[0][price_data][recurring][interval]"]).toBe("year");
  });
});
