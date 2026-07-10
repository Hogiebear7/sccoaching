import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStripePassCheckout,
  createStripeSubscriptionCheckout,
  isStripeConfigured,
} from "@/lib/providers/stripe";
import { verifyStripeSignature } from "@/lib/providers/stripe-webhook";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/cs_test_1" }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("stripe checkout creation", () => {
  it("is configured only when the secret key exists", () => {
    expect(isStripeConfigured()).toBe(true);
    delete process.env.STRIPE_SECRET_KEY;
    expect(isStripeConfigured()).toBe(false);
  });

  it("sends an Idempotency-Key derived from the purchase id (pass packs)", async () => {
    const result = await createStripePassCheckout({
      amountCents: 12000,
      productName: "10 Pass Pack (10 class passes)",
      purchaseId: "pur-1",
      customerEmail: "athlete@example.com",
    });

    expect(result).toEqual({
      ok: true,
      sessionId: "cs_test_1",
      checkoutUrl: "https://checkout.stripe.com/c/cs_test_1",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.headers["Idempotency-Key"]).toBe("pass:pur-1");
    expect(init.headers.Authorization).toBe("Bearer sk_test_123");

    const params = new URLSearchParams(init.body);
    expect(params.get("mode")).toBe("payment");
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("12000");
    expect(params.get("metadata[purchase_id]")).toBe("pur-1");
    expect(params.get("payment_intent_data[metadata][purchase_id]")).toBe("pur-1");
    expect(params.get("client_reference_id")).toBe("pur-1");
  });

  it("creates subscription-mode sessions with recurring pricing", async () => {
    await createStripeSubscriptionCheckout({
      amountCents: 4999,
      planName: "Premium",
      interval: "month",
      internalReference: "user-1:plan-1:123",
      customerEmail: "athlete@example.com",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Idempotency-Key"]).toBe("sub:user-1:plan-1:123");
    const params = new URLSearchParams(init.body);
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(params.get("subscription_data[metadata][internal_ref]")).toBe("user-1:plan-1:123");
  });

  it("returns ok:false on provider errors instead of throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "bad request" });
    const result = await createStripePassCheckout({
      amountCents: 100,
      productName: "x",
      purchaseId: "p",
      customerEmail: "a@b.c",
    });
    expect(result.ok).toBe(false);
  });
});

describe("stripe webhook signature verification", () => {
  function sign(body: string, timestamp: number, secret = "whsec_test_secret"): string {
    const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return `t=${timestamp},v1=${v1}`;
  }

  it("accepts a valid, fresh signature", () => {
    const body = '{"id":"evt_1"}';
    const now = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(body, sign(body, now))).toBe(true);
  });

  it("rejects wrong secrets, tampered bodies, stale timestamps, and missing headers", () => {
    const body = '{"id":"evt_1"}';
    const now = Math.floor(Date.now() / 1000);

    expect(verifyStripeSignature(body, sign(body, now, "whsec_wrong"))).toBe(false);
    expect(verifyStripeSignature('{"id":"evt_2"}', sign(body, now))).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 3600))).toBe(false);
    expect(verifyStripeSignature(body, null)).toBe(false);
  });
});
