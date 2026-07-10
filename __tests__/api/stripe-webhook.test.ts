import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindPurchaseByProviderOrderId,
  mockFindPurchaseById,
  mockFindPurchaseByProviderPaymentRef,
  mockFindSubscriptionBySetupOrderId,
  mockFindSubscriptionByProviderOrderId,
  mockFindClassPassProductById,
  mockFindMembershipPlanById,
  mockHasPaymentEvent,
  mockRecordPaymentEvent,
  mockSavePurchase,
  mockSaveSubscription,
  mockAppendPassLedgerEntry,
  mockFindPassLedgerByPurchaseId,
} = vi.hoisted(() => ({
  mockFindPurchaseByProviderOrderId: vi.fn(),
  mockFindPurchaseById: vi.fn(),
  mockFindPurchaseByProviderPaymentRef: vi.fn(),
  mockFindSubscriptionBySetupOrderId: vi.fn(),
  mockFindSubscriptionByProviderOrderId: vi.fn(),
  mockFindClassPassProductById: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
  mockHasPaymentEvent: vi.fn(),
  mockRecordPaymentEvent: vi.fn(),
  mockSavePurchase: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockAppendPassLedgerEntry: vi.fn(),
  mockFindPassLedgerByPurchaseId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findPurchaseByProviderOrderId: mockFindPurchaseByProviderOrderId,
  findPurchaseById: mockFindPurchaseById,
  findPurchaseByProviderPaymentRef: mockFindPurchaseByProviderPaymentRef,
  findSubscriptionBySetupOrderId: mockFindSubscriptionBySetupOrderId,
  findSubscriptionByProviderOrderId: mockFindSubscriptionByProviderOrderId,
  findClassPassProductById: mockFindClassPassProductById,
  findMembershipPlanById: mockFindMembershipPlanById,
  hasPaymentEvent: mockHasPaymentEvent,
  recordPaymentEvent: mockRecordPaymentEvent,
  savePurchase: mockSavePurchase,
  saveSubscription: mockSaveSubscription,
  appendPassLedgerEntry: mockAppendPassLedgerEntry,
  findPassLedgerByPurchaseId: mockFindPassLedgerByPurchaseId,
  findPassLedgerByUserId: vi.fn(() => []),
  findPassLedgerByBookingId: vi.fn(() => []),
}));

// Signature layer is unit-tested in stripe-provider.test.ts; accept here so
// the business behavior is what's exercised.
vi.mock("@/lib/providers/stripe-webhook", () => ({
  isStripeWebhookConfigured: () => true,
  verifyStripeSignature: () => true,
}));

const PURCHASE = {
  id: "pur-1",
  userId: "user-1",
  kind: "pass_pack" as const,
  productId: "pack-10",
  description: "10 Pass Pack — 10 class passes",
  amountCents: 12000,
  status: "pending" as const,
  provider: "stripe" as const,
  providerOrderId: "cs_test_1",
  providerPaymentRef: null,
  checkoutUrl: "https://x",
  idempotencyKey: "user-1:pack-10",
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T10:00:00.000Z",
};

const PRODUCT = {
  id: "pack-10",
  name: "10 Pass Pack",
  description: null,
  passCount: 10,
  priceCents: 12000,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const SUBSCRIPTION = {
  userId: "user-2",
  planId: "plan-1",
  status: "pending" as const,
  provider: "stripe" as const,
  providerCustomerId: null,
  providerSubscriptionId: null,
  providerSetupOrderId: "cs_sub_1",
  currentPeriodEnd: null,
  lastWebhookEventAt: null,
  sessionsUsedThisPeriod: 3,
  extraSessionGrants: [{ id: "g1", amount: 1, note: null, grantedByUserId: "s", createdAt: "x" }],
  periodLapsedNotifiedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

async function postEvent(event: {
  id: string;
  type: string;
  object: Record<string, unknown>;
}) {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const request = new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "sig" },
    body: JSON.stringify({ id: event.id, type: event.type, data: { object: event.object } }),
  });
  return POST(request);
}

describe("stripe webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindPurchaseByProviderOrderId.mockReturnValue(PURCHASE);
    mockFindPurchaseById.mockReturnValue(undefined);
    mockFindPurchaseByProviderPaymentRef.mockReturnValue(undefined);
    mockFindClassPassProductById.mockReturnValue(PRODUCT);
    mockFindSubscriptionBySetupOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue(undefined);
    mockFindMembershipPlanById.mockReturnValue({ billingInterval: "monthly" });
    mockHasPaymentEvent.mockReturnValue(false);
    mockFindPassLedgerByPurchaseId.mockReturnValue([]);
  });

  it("checkout.session.completed (paid) marks the purchase paid, stores the payment ref, credits once", async () => {
    const res = await postEvent({
      id: "evt_1",
      type: "checkout.session.completed",
      object: { id: "cs_test_1", mode: "payment", payment_status: "paid", payment_intent: "pi_1" },
    });

    expect(res.status).toBe(200);
    // transition save, then payment-ref save
    expect(mockSavePurchase.mock.calls[0][0].status).toBe("paid");
    expect(mockSavePurchase.mock.calls[1][0].providerPaymentRef).toBe("pi_1");
    expect(mockAppendPassLedgerEntry).toHaveBeenCalledTimes(1);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      delta: 10,
      reason: "purchase",
      purchaseId: "pur-1",
    });
    expect(mockRecordPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({ key: "evt_1" }));
  });

  it("replayed event ids are acknowledged and never re-applied", async () => {
    mockHasPaymentEvent.mockReturnValue(true);
    const res = await postEvent({
      id: "evt_1",
      type: "checkout.session.completed",
      object: { id: "cs_test_1", mode: "payment", payment_status: "paid" },
    });
    expect(res.status).toBe(200);
    expect(mockSavePurchase).not.toHaveBeenCalled();
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordPaymentEvent).not.toHaveBeenCalled();
  });

  it("does not credit while a delayed payment is still unpaid", async () => {
    const res = await postEvent({
      id: "evt_2",
      type: "checkout.session.completed",
      object: { id: "cs_test_1", mode: "payment", payment_status: "unpaid" },
    });
    expect(res.status).toBe(200);
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
    // still recorded so the retry of this same event short-circuits
    expect(mockRecordPaymentEvent).toHaveBeenCalled();
  });

  it("a completed event after a refund applies nothing", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue({ ...PURCHASE, status: "refunded" });
    await postEvent({
      id: "evt_3",
      type: "checkout.session.completed",
      object: { id: "cs_test_1", mode: "payment", payment_status: "paid" },
    });
    expect(mockSavePurchase).not.toHaveBeenCalled();
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
  });

  it("async payment failure and expiry transition without crediting", async () => {
    await postEvent({
      id: "evt_4",
      type: "checkout.session.async_payment_failed",
      object: { id: "cs_test_1" },
    });
    expect(mockSavePurchase.mock.calls[0][0].status).toBe("failed");

    mockSavePurchase.mockClear();
    await postEvent({ id: "evt_5", type: "checkout.session.expired", object: { id: "cs_test_1" } });
    expect(mockSavePurchase.mock.calls[0][0].status).toBe("cancelled");
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
  });

  it("charge.refunded correlates via payment intent and reverses the credit", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindPurchaseByProviderPaymentRef.mockReturnValue({
      ...PURCHASE,
      status: "paid",
      providerPaymentRef: "pi_1",
    });
    mockFindPassLedgerByPurchaseId.mockReturnValue([
      { id: "led-1", userId: "user-1", delta: 10, reason: "purchase", purchaseId: "pur-1", bookingId: null, note: null, createdAt: "x" },
    ]);

    const res = await postEvent({
      id: "evt_6",
      type: "charge.refunded",
      object: { id: "ch_1", payment_intent: "pi_1" },
    });

    expect(res.status).toBe(200);
    expect(mockSavePurchase.mock.calls[0][0].status).toBe("refunded");
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      delta: -10,
      reason: "refund_reversal",
    });
  });

  it("subscription-mode completion activates the membership with provider ids", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionBySetupOrderId.mockReturnValue(SUBSCRIPTION);

    const res = await postEvent({
      id: "evt_7",
      type: "checkout.session.completed",
      object: {
        id: "cs_sub_1",
        mode: "subscription",
        payment_status: "paid",
        subscription: "sub_123",
        customer: "cus_456",
      },
    });

    expect(res.status).toBe(200);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved).toMatchObject({
      status: "active",
      providerSubscriptionId: "sub_123",
      providerCustomerId: "cus_456",
      // fresh period: usage and staff grants reset
      sessionsUsedThisPeriod: 0,
      extraSessionGrants: [],
    });
    expect(saved.currentPeriodEnd).toBeTruthy();
  });

  it("invoice.payment_failed and subscription.deleted map to past_due / canceled", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      status: "active",
      providerSubscriptionId: "sub_123",
    });

    await postEvent({
      id: "evt_8",
      type: "invoice.payment_failed",
      object: { id: "in_1", subscription: "sub_123" },
    });
    expect(mockSaveSubscription.mock.calls[0][0].status).toBe("past_due");

    mockSaveSubscription.mockClear();
    await postEvent({
      id: "evt_9",
      type: "customer.subscription.deleted",
      object: { id: "sub_123" },
    });
    expect(mockSaveSubscription.mock.calls[0][0].status).toBe("canceled");
  });

  it("reads the subscription id from 2025+ nested invoice payloads", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      status: "active",
      providerSubscriptionId: "sub_123",
    });

    await postEvent({
      id: "evt_10",
      type: "invoice.payment_failed",
      object: { id: "in_2", parent: { subscription_details: { subscription: "sub_123" } } },
    });
    expect(mockSaveSubscription.mock.calls[0][0].status).toBe("past_due");
  });
});
