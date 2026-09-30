import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveEntitlement,
  mockFindSubscriptionByProviderOrderId,
  mockSaveSubscription,
  mockFindMembershipBillingOptionById,
  mockFindRevenueEventByProviderRef,
  mockCreateRevenueEvent,
} = vi.hoisted(() => ({
  mockResolveEntitlement: vi.fn(),
  mockFindSubscriptionByProviderOrderId: vi.fn(),
  mockSaveSubscription: vi.fn(),
  // Revenue ledger: no billing option on file by default, so the
  // ORDER_COMPLETED revenue-recording branch is a no-op (see the amountCents
  // guard in app/api/billing/webhook/route.ts) — overridden per-test below
  // for the dedicated revenue-event/ownerGym tests. Plain vi.fn() (not
  // vi.fn(() => undefined)) so a later .mockReturnValue() with a real object
  // isn't rejected by the type inferred from an undefined-only factory.
  mockFindMembershipBillingOptionById: vi.fn(),
  mockFindRevenueEventByProviderRef: vi.fn(),
  mockCreateRevenueEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findSubscriptionByProviderOrderId: mockFindSubscriptionByProviderOrderId,
  saveSubscription: mockSaveSubscription,
  // Commerce layer: no pass purchase matches in these membership scenarios,
  // so every event falls through to the subscription path under test.
  findPurchaseByProviderOrderId: vi.fn(() => undefined),
  findMembershipPackageById: vi.fn(() => undefined),
  hasPaymentEvent: vi.fn(() => false),
  recordPaymentEvent: vi.fn(),
  savePurchase: vi.fn(),
  appendPassLedgerEntry: vi.fn(),
  findPassLedgerByPurchaseId: vi.fn(() => []),
  findPassLedgerByUserId: vi.fn(() => []),
  findMembershipBillingOptionById: mockFindMembershipBillingOptionById,
  findRevenueEventByProviderRef: mockFindRevenueEventByProviderRef,
  createRevenueEvent: mockCreateRevenueEvent,
}));

vi.mock("@/lib/membership-entitlement", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/membership-entitlement")>()),
  resolveSubscriptionEntitlement: mockResolveEntitlement,
}));

const SIGNING_SECRET = "wsk_test_secret";

function sign(timestamp: string, rawBody: string): string {
  const payloadToSign = `v1.${timestamp}.${rawBody}`;
  return `v1=${createHmac("sha256", SIGNING_SECRET).update(payloadToSign).digest("hex")}`;
}

function makeRequest(rawBody: string, timestamp: string, signature: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("revolut-signature", signature);
  headers.set("revolut-request-timestamp", timestamp);

  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("POST /api/billing/webhook", () => {
  const originalSecret = process.env.REVOLUT_WEBHOOK_SIGNING_SECRET;

  beforeEach(() => {
    process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
    mockResolveEntitlement.mockReset();
    mockFindSubscriptionByProviderOrderId.mockReset();
    mockSaveSubscription.mockReset();
    mockFindMembershipBillingOptionById.mockReset().mockReturnValue(undefined);
    mockFindRevenueEventByProviderRef.mockReset().mockReturnValue(undefined);
    mockCreateRevenueEvent.mockReset();
  });

  afterEach(() => {
    process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = originalSecret;
  });

  it("rejects requests with an invalid signature", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());

    const res = await POST(makeRequest(rawBody, timestamp, "v1=not-the-real-signature"));

    expect(res.status).toBe(401);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("rejects requests with a stale timestamp", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const staleTimestamp = String(Date.now() - 10 * 60 * 1000);
    const signature = sign(staleTimestamp, rawBody);

    const res = await POST(makeRequest(rawBody, staleTimestamp, signature));

    expect(res.status).toBe(401);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("updates the matching subscription to active on ORDER_COMPLETED", async () => {
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      userId: "user-1",
      planId: "plan-1",
      status: "pending",
      provider: "revolut",
      providerCustomerId: null,
      providerSubscriptionId: "order-1",
      currentPeriodEnd: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockResolveEntitlement.mockReturnValue({
      id: "plan-1",
      name: "Premium",
      description: null,
      priceCents: 4999,
      billingInterval: "monthly",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    const res = await POST(makeRequest(rawBody, timestamp, signature));

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.status).toBe("active");
    expect(saved.currentPeriodEnd).not.toBeNull();
  });

  it("stamps a new revenue event with the subscription's own ownerGym", async () => {
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      userId: "user-1",
      packageId: "pkg-1",
      billingOptionId: "opt-1",
      status: "pending",
      provider: "revolut",
      providerSubscriptionId: "order-1",
      currentPeriodEnd: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ownerGym: { scope: "gym", gymId: "gym-a" },
    });
    mockResolveEntitlement.mockReturnValue({ billingInterval: "monthly" });
    mockFindMembershipBillingOptionById.mockReturnValue({ id: "opt-1", amountCents: 2500, currency: "eur" });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    const res = await POST(makeRequest(rawBody, timestamp, signature));

    expect(res.status).toBe(200);
    expect(mockCreateRevenueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "revolut", ownerGym: { scope: "gym", gymId: "gym-a" } })
    );
  });

  it("marks a revenue event unresolved when the subscription predates ownerGym", async () => {
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      userId: "user-1",
      packageId: "pkg-1",
      billingOptionId: "opt-1",
      status: "pending",
      provider: "revolut",
      providerSubscriptionId: "order-1",
      currentPeriodEnd: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      // no ownerGym field at all
    });
    mockResolveEntitlement.mockReturnValue({ billingInterval: "monthly" });
    mockFindMembershipBillingOptionById.mockReturnValue({ id: "opt-1", amountCents: 2500, currency: "eur" });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    await POST(makeRequest(rawBody, timestamp, signature));

    expect(mockCreateRevenueEvent).toHaveBeenCalledWith(expect.objectContaining({ ownerGym: { scope: "unresolved" } }));
  });

  it("does not create a duplicate revenue event, or a second one with different ownership, on a replayed webhook", async () => {
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      userId: "user-1",
      packageId: "pkg-1",
      billingOptionId: "opt-1",
      status: "active",
      provider: "revolut",
      providerSubscriptionId: "order-1",
      currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ownerGym: { scope: "gym", gymId: "gym-a" },
    });
    mockResolveEntitlement.mockReturnValue({ billingInterval: "monthly" });
    mockFindMembershipBillingOptionById.mockReturnValue({ id: "opt-1", amountCents: 2500, currency: "eur" });
    // Simulates the dedupe check seeing an already-recorded event for this order.
    mockFindRevenueEventByProviderRef.mockReturnValue({ id: "existing-rev", ownerGym: { scope: "gym", gymId: "gym-a" } });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    const res = await POST(makeRequest(rawBody, timestamp, signature));

    expect(res.status).toBe(200);
    expect(mockCreateRevenueEvent).not.toHaveBeenCalled();
  });

  it("acknowledges but ignores events for an unknown order", async () => {
    mockFindSubscriptionByProviderOrderId.mockReturnValue(undefined);

    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "unknown-order" });
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    const res = await POST(makeRequest(rawBody, timestamp, signature));

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("ignores an out-of-order event older than the last applied update", async () => {
    const lastAppliedMs = Date.now();
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      userId: "user-1",
      planId: "plan-1",
      status: "active",
      provider: "revolut",
      providerCustomerId: null,
      providerSubscriptionId: "order-1",
      currentPeriodEnd: "2026-02-01T00:00:00.000Z",
      lastWebhookEventAt: new Date(lastAppliedMs).toISOString(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/billing/webhook/route");
    // A late-arriving ORDER_FAILED with an earlier timestamp than the
    // already-applied event shouldn't regress the subscription to past_due.
    const rawBody = JSON.stringify({ event: "ORDER_FAILED", order_id: "order-1" });
    const lateTimestamp = String(lastAppliedMs - 5000);
    const signature = sign(lateTimestamp, rawBody);

    const res = await POST(makeRequest(rawBody, lateTimestamp, signature));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toMatch(/older than the last applied/i);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("activates a subscription when SUBSCRIPTION_INITIATED carries subscription_id instead of order_id", async () => {
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      userId: "user-1",
      planId: "plan-1",
      status: "pending",
      provider: "revolut",
      providerCustomerId: "cust-1",
      providerSubscriptionId: "sub-1",
      currentPeriodEnd: null,
      lastWebhookEventAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockResolveEntitlement.mockReturnValue({
      id: "plan-1",
      name: "Premium",
      description: null,
      priceCents: 4999,
      billingInterval: "monthly",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/billing/webhook/route");
    // Revolut sends subscription_id rather than order_id for this event type.
    const rawBody = JSON.stringify({ event: "SUBSCRIPTION_INITIATED", subscription_id: "sub-1" });
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    const res = await POST(makeRequest(rawBody, timestamp, signature));

    expect(res.status).toBe(200);
    expect(mockFindSubscriptionByProviderOrderId).toHaveBeenCalledWith("sub-1");
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.status).toBe("active");
  });

  it("accepts a valid event delivered with a multi-signature Revolut-Signature header", async () => {
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      userId: "user-1",
      planId: "plan-1",
      status: "pending",
      provider: "revolut",
      providerCustomerId: null,
      providerSubscriptionId: "order-1",
      currentPeriodEnd: null,
      lastWebhookEventAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockResolveEntitlement.mockReturnValue({
      id: "plan-1",
      name: "Premium",
      description: null,
      priceCents: 4999,
      billingInterval: "monthly",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const validSig = sign(timestamp, rawBody);
    // Simulate key-rotation multi-signature header; only second sig is correct.
    const multiSigHeader = `v1=aaabbbcccddd000,${validSig}`;

    const headers = new Headers({ "content-type": "application/json" });
    headers.set("revolut-signature", multiSigHeader);
    headers.set("revolut-request-timestamp", timestamp);
    const request = new NextRequest("http://localhost/api/billing/webhook", {
      method: "POST",
      headers,
      body: rawBody,
    });

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    expect(mockSaveSubscription.mock.calls[0][0].status).toBe("active");
  });

  it("applies a newer event even when an earlier event was already recorded", async () => {
    const earlierMs = Date.now() - 60_000;
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      userId: "user-1",
      planId: "plan-1",
      status: "pending",
      provider: "revolut",
      providerCustomerId: null,
      providerSubscriptionId: "order-1",
      currentPeriodEnd: null,
      lastWebhookEventAt: new Date(earlierMs).toISOString(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockResolveEntitlement.mockReturnValue({
      id: "plan-1",
      name: "Premium",
      description: null,
      priceCents: 4999,
      billingInterval: "monthly",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/billing/webhook/route");
    const rawBody = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "order-1" });
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    const res = await POST(makeRequest(rawBody, timestamp, signature));

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.status).toBe("active");
    expect(saved.lastWebhookEventAt).toBe(new Date(Number(timestamp)).toISOString());
  });
});
