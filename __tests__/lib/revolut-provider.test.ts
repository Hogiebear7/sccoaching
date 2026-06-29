import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRevolutCustomer,
  createRevolutOrder,
  createRevolutSubscription,
  isRevolutConfigured,
} from "@/lib/providers/revolut";

describe("lib/providers/revolut", () => {
  const originalSecretKey = process.env.REVOLUT_SECRET_KEY;
  const originalEnv = process.env.REVOLUT_ENV;
  const originalCurrency = process.env.REVOLUT_CURRENCY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.REVOLUT_SECRET_KEY;
    delete process.env.REVOLUT_ENV;
    delete process.env.REVOLUT_CURRENCY;
  });

  afterEach(() => {
    process.env.REVOLUT_SECRET_KEY = originalSecretKey;
    process.env.REVOLUT_ENV = originalEnv;
    process.env.REVOLUT_CURRENCY = originalCurrency;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reports unconfigured when REVOLUT_SECRET_KEY is unset", () => {
    expect(isRevolutConfigured()).toBe(false);
  });

  it("reports configured once REVOLUT_SECRET_KEY is set", () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";
    expect(isRevolutConfigured()).toBe(true);
  });

  it("does not attempt a network call when unconfigured", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutOrder({
      amountCents: 4999,
      internalReference: "user-1:plan-1:123",
      customerEmail: "member@example.com",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("calls the sandbox endpoint with the expected auth header and body when configured", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "order-1", checkout_url: "https://sandbox-pay.revolut.com/order-1" }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutOrder({
      amountCents: 4999,
      internalReference: "user-1:plan-1:123",
      customerEmail: "member@example.com",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://sandbox-merchant.revolut.com/api/orders");
    expect(options.headers.Authorization).toBe("Bearer sk_test_123");
    const body = JSON.parse(options.body);
    expect(body.amount).toBe(4999);
    expect(body.merchant_order_ext_ref).toBe("user-1:plan-1:123");

    expect(result).toEqual({
      ok: true,
      orderId: "order-1",
      checkoutUrl: "https://sandbox-pay.revolut.com/order-1",
    });
  });

  it("uses the production endpoint when REVOLUT_ENV=production", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";
    process.env.REVOLUT_ENV = "production";

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "order-1", checkout_url: "https://pay.revolut.com/order-1" }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await createRevolutOrder({
      amountCents: 4999,
      internalReference: "user-1:plan-1:123",
      customerEmail: "member@example.com",
    });

    expect(fetchSpy.mock.calls[0][0]).toBe("https://merchant.revolut.com/api/orders");
  });

  it("returns ok:false instead of throwing when the API responds with an error status", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Invalid API key",
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutOrder({
      amountCents: 4999,
      internalReference: "user-1:plan-1:123",
      customerEmail: "member@example.com",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("401");
    }
  });

  it("returns ok:false instead of throwing on a network failure", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutOrder({
      amountCents: 4999,
      internalReference: "user-1:plan-1:123",
      customerEmail: "member@example.com",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("network down");
    }
  });

  it("returns ok:false instead of sending a malformed currency", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";
    process.env.REVOLUT_CURRENCY = "dollars";

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutOrder({
      amountCents: 4999,
      internalReference: "user-1:plan-1:123",
      customerEmail: "member@example.com",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("REVOLUT_CURRENCY");
    }
  });
});

describe("createRevolutCustomer", () => {
  const originalSecretKey = process.env.REVOLUT_SECRET_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.REVOLUT_SECRET_KEY;
  });

  afterEach(() => {
    process.env.REVOLUT_SECRET_KEY = originalSecretKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns ok:false without calling fetch when unconfigured", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutCustomer("member@example.com");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("calls the customers endpoint with the correct auth header and email", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cust-1" }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutCustomer("member@example.com");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://sandbox-merchant.revolut.com/api/1.0/customers");
    expect(options.headers.Authorization).toBe("Bearer sk_test_123");
    const body = JSON.parse(options.body);
    expect(body.email).toBe("member@example.com");

    expect(result).toEqual({ ok: true, customerId: "cust-1" });
  });

  it("returns ok:false on an API error response", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Invalid email",
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutCustomer("bad-email");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("422");
    }
  });

  it("returns ok:false on a network failure", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    global.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;

    const result = await createRevolutCustomer("member@example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("timeout");
    }
  });
});

describe("createRevolutSubscription", () => {
  const originalSecretKey = process.env.REVOLUT_SECRET_KEY;
  const originalCurrency = process.env.REVOLUT_CURRENCY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    delete process.env.REVOLUT_SECRET_KEY;
    delete process.env.REVOLUT_CURRENCY;
  });

  afterEach(() => {
    process.env.REVOLUT_SECRET_KEY = originalSecretKey;
    process.env.REVOLUT_CURRENCY = originalCurrency;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns ok:false without calling fetch when unconfigured", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutSubscription({
      customerId: "cust-1",
      amountCents: 4999,
      billingIntervalMonths: 1,
      internalReference: "user-1:plan-1:123",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("calls the subscriptions endpoint then fetches the setup order checkout URL", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "sub-1", setup_order_id: "ord-setup-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ checkout_url: "https://sandbox-pay.revolut.com/payment-link/ord-setup-1" }),
      });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutSubscription({
      customerId: "cust-1",
      amountCents: 4999,
      billingIntervalMonths: 1,
      internalReference: "user-1:plan-1:123",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [subUrl, subOptions] = fetchSpy.mock.calls[0];
    expect(subUrl).toBe("https://sandbox-merchant.revolut.com/api/1.0/subscriptions");
    expect(subOptions.headers.Authorization).toBe("Bearer sk_test_123");
    const subBody = JSON.parse(subOptions.body);
    expect(subBody.customer_id).toBe("cust-1");
    expect(subBody.amount).toBe(4999);
    expect(subBody.billing_period).toEqual({ unit: "MONTH", count: 1 });

    const [orderUrl] = fetchSpy.mock.calls[1];
    expect(orderUrl).toBe("https://sandbox-merchant.revolut.com/api/orders/ord-setup-1");

    expect(result).toEqual({
      ok: true,
      subscriptionId: "sub-1",
      setupOrderId: "ord-setup-1",
      checkoutUrl: "https://sandbox-pay.revolut.com/payment-link/ord-setup-1",
    });
  });

  it("uses count:12 for an annual billing interval", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "sub-2", setup_order_id: "ord-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ checkout_url: "https://sandbox-pay.revolut.com/payment-link/ord-2" }),
      });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await createRevolutSubscription({
      customerId: "cust-1",
      amountCents: 49900,
      billingIntervalMonths: 12,
      internalReference: "user-1:plan-1:123",
    });

    const subBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(subBody.billing_period).toEqual({ unit: "MONTH", count: 12 });
  });

  it("uses checkout_url directly from subscription response when present, skipping setup order fetch", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    // Only one fetch call — subscription response already has checkout_url.
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "sub-1",
        checkout_url: "https://sandbox-pay.revolut.com/payment-link/sub-1",
        // Note: no setup_order_id returned
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutSubscription({
      customerId: "cust-1",
      amountCents: 4999,
      billingIntervalMonths: 1,
      internalReference: "user-1:plan-1:123",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      subscriptionId: "sub-1",
      setupOrderId: null,
      checkoutUrl: "https://sandbox-pay.revolut.com/payment-link/sub-1",
    });
  });

  it("stores setup_order_id alongside checkout_url when both are returned", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "sub-1",
        setup_order_id: "ord-setup-1",
        checkout_url: "https://sandbox-pay.revolut.com/payment-link/sub-1",
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutSubscription({
      customerId: "cust-1",
      amountCents: 4999,
      billingIntervalMonths: 1,
      internalReference: "user-1:plan-1:123",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      subscriptionId: "sub-1",
      setupOrderId: "ord-setup-1",
      checkoutUrl: "https://sandbox-pay.revolut.com/payment-link/sub-1",
    });
  });

  it("returns ok:false when both checkout_url and setup_order_id are absent from response", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "sub-1" }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutSubscription({
      customerId: "cust-1",
      amountCents: 4999,
      billingIntervalMonths: 1,
      internalReference: "user-1:plan-1:123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("checkout_url");
      expect(result.message).toContain("setup_order_id");
    }
  });

  it("returns ok:false if the subscription API call fails", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutSubscription({
      customerId: "cust-1",
      amountCents: 4999,
      billingIntervalMonths: 1,
      internalReference: "user-1:plan-1:123",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("401");
    }
  });

  it("returns ok:false if the setup order checkout URL fetch fails", async () => {
    process.env.REVOLUT_SECRET_KEY = "sk_test_123";

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "sub-1", setup_order_id: "ord-setup-1" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not found",
      });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createRevolutSubscription({
      customerId: "cust-1",
      amountCents: 4999,
      billingIntervalMonths: 1,
      internalReference: "user-1:plan-1:123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("404");
    }
  });
});
