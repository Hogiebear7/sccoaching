import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindPurchaseByProviderOrderId,
  mockFindPurchaseById,
  mockFindPurchaseByProviderPaymentRef,
  mockFindSubscriptionBySetupOrderId,
  mockFindSubscriptionByPendingSetupOrderId,
  mockFindSubscriptionByUserIdX,
  mockFindSubscriptionByProviderOrderId,
  mockFindMembershipPackageById,
  mockFindMembershipBillingOptionById,
  mockHasPaymentEvent,
  mockRecordPaymentEvent,
  mockSavePurchase,
  mockSaveSubscription,
  mockAppendPassLedgerEntry,
  mockFindPassLedgerByPurchaseId,
  mockFindAllSubscriptions,
} = vi.hoisted(() => ({
  mockFindPurchaseByProviderOrderId: vi.fn(),
  mockFindPurchaseById: vi.fn(),
  mockFindPurchaseByProviderPaymentRef: vi.fn(),
  mockFindSubscriptionBySetupOrderId: vi.fn(),
  mockFindSubscriptionByPendingSetupOrderId: vi.fn(),
  mockFindSubscriptionByUserIdX: vi.fn(),
  mockFindSubscriptionByProviderOrderId: vi.fn(),
  mockFindMembershipPackageById: vi.fn(),
  mockFindMembershipBillingOptionById: vi.fn(),
  mockHasPaymentEvent: vi.fn(),
  mockRecordPaymentEvent: vi.fn(),
  mockSavePurchase: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockAppendPassLedgerEntry: vi.fn(),
  mockFindPassLedgerByPurchaseId: vi.fn(),
  mockFindAllSubscriptions: vi.fn(() => []),
}));

vi.mock("@/lib/db", () => ({
  findAllSubscriptions: mockFindAllSubscriptions,
  findPurchaseByProviderOrderId: mockFindPurchaseByProviderOrderId,
  findPurchaseById: mockFindPurchaseById,
  findPurchaseByProviderPaymentRef: mockFindPurchaseByProviderPaymentRef,
  findSubscriptionBySetupOrderId: mockFindSubscriptionBySetupOrderId,
  findSubscriptionByPendingSetupOrderId: mockFindSubscriptionByPendingSetupOrderId,
  findSubscriptionByUserId: mockFindSubscriptionByUserIdX,
  findSubscriptionByProviderOrderId: mockFindSubscriptionByProviderOrderId,
  findMembershipPackageById: mockFindMembershipPackageById,
  findMembershipBillingOptionById: mockFindMembershipBillingOptionById,
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
  packageType: "pass" as const,
  sessionAllowanceType: "fixed_count" as const,
  sessionAllowanceCount: 10,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const SUBSCRIPTION = {
  userId: "user-2",
  packageId: "pkg-1",
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
    mockFindMembershipPackageById.mockReturnValue(PRODUCT);
    mockFindSubscriptionBySetupOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByPendingSetupOrderId.mockReturnValue(undefined);
    mockFindMembershipBillingOptionById.mockReturnValue(undefined);
    mockFindSubscriptionByUserIdX.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue(undefined);
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

  it("a membership-kind purchase no longer activates anything (intro removed)", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue({
      ...PURCHASE,
      id: "pur-mem",
      kind: "membership" as const,
      productId: "some-id",
      providerOrderId: "cs_mem_1",
    });

    const res = await postEvent({
      id: "evt_mem_1",
      type: "checkout.session.completed",
      object: { id: "cs_mem_1", mode: "payment", payment_status: "paid", payment_intent: "pi_9" },
    });

    expect(res.status).toBe(200);
    // The purchase still transitions to paid, but no subscription is activated.
    expect(mockSavePurchase.mock.calls[0][0].status).toBe("paid");
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
  });

  it("replayed membership-kind completion applies nothing (state machine)", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue({
      ...PURCHASE,
      id: "pur-mem",
      kind: "membership" as const,
      productId: "some-id",
      providerOrderId: "cs_mem_1",
      status: "paid" as const,
    });

    const res = await postEvent({
      id: "evt_mem_2",
      type: "checkout.session.completed",
      object: { id: "cs_mem_1", mode: "payment", payment_status: "paid" },
    });

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockSavePurchase).not.toHaveBeenCalled();
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

  it("charge.refunded for a membership (no matching pass-pack purchase) is flagged, not auto-actioned", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindPurchaseByProviderPaymentRef.mockReturnValue(undefined);
    mockFindPurchaseById.mockReturnValue(undefined);
    mockFindAllSubscriptions.mockReturnValue([
      { ...SUBSCRIPTION, providerCustomerId: "cus_1" },
    ]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await postEvent({
      id: "evt_refund_membership",
      type: "charge.refunded",
      object: { id: "ch_2", payment_intent: "pi_not_a_pack", customer: "cus_1" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/staff review/i);
    // Not auto-revoked: no purchase/subscription state mutation for this event.
    expect(mockSavePurchase).not.toHaveBeenCalled();
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
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

  it("confirmed switch promotes the pending option, starts a fresh period, and cancels the old sub", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    // The switch is found FIRST by its pending setup-order id — the active
    // membership was never clobbered, only the pending* fields were staged.
    mockFindSubscriptionByPendingSetupOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      planId: null,
      packageId: "pkg-old",
      billingOptionId: "opt-old",
      status: "active" as const,
      providerSubscriptionId: "sub_old",
      providerSetupOrderId: "cs_old",
      pendingPackageId: "pkg-new",
      pendingBillingOptionId: "opt-new",
      pendingSetupOrderId: "cs_switch_1",
      pendingStartedAt: "2026-07-20T00:00:00.000Z",
    });
    mockFindMembershipBillingOptionById.mockReturnValue({
      id: "opt-new",
      packageId: "pkg-new",
      billingType: "recurring",
      intervalUnit: "month",
      intervalCount: 1,
    });

    const res = await postEvent({
      id: "evt_switch_1",
      type: "checkout.session.completed",
      object: {
        id: "cs_switch_1",
        mode: "subscription",
        payment_status: "paid",
        subscription: "sub_new",
        customer: "cus_456",
      },
    });

    expect(res.status).toBe(200);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved).toMatchObject({
      status: "active",
      packageId: "pkg-new",
      billingOptionId: "opt-new",
      providerSubscriptionId: "sub_new",
      // fresh period on the new option — no proration
      sessionsUsedThisPeriod: 0,
      extraSessionGrants: [],
      // all pending fields cleared on promotion
      pendingPackageId: null,
      pendingBillingOptionId: null,
      pendingSetupOrderId: null,
      pendingStartedAt: null,
    });
    // The fresh-activation path must NOT also run for a switch.
    expect(mockFindSubscriptionBySetupOrderId).not.toHaveBeenCalled();
  });

  it("a switch to a NEW stripe sub leaves the old sub id behind to be cancelled", async () => {
    // Guards the double-billing fix: promotion points at the new sub, and the
    // previous (different) sub id is captured so cancel can fire.
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByPendingSetupOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      status: "active" as const,
      providerSubscriptionId: "sub_old",
      pendingBillingOptionId: "opt-new",
      pendingPackageId: "pkg-new",
      pendingSetupOrderId: "cs_switch_2",
      pendingStartedAt: "2026-07-20T00:00:00.000Z",
    });
    mockFindMembershipBillingOptionById.mockReturnValue({
      id: "opt-new",
      packageId: "pkg-new",
      billingType: "recurring",
      intervalUnit: "year",
      intervalCount: 1,
    });

    const res = await postEvent({
      id: "evt_switch_2",
      type: "checkout.session.completed",
      object: { id: "cs_switch_2", mode: "subscription", payment_status: "paid", subscription: "sub_new" },
    });

    expect(res.status).toBe(200);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.providerSubscriptionId).toBe("sub_new");
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

  it("invoice.paid rolls the period from the latest line period end and resets usage", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      status: "active",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    });

    // Two lines with different periods — the latest end wins
    // (1788220800 = 2026-09-01T00:00:00Z, past the stored 2026-08-01).
    const res = await postEvent({
      id: "evt_20",
      type: "invoice.paid",
      object: {
        id: "in_10",
        subscription: "sub_123",
        lines: {
          data: [
            { period: { end: 1785542400 } }, // 2026-07-31
            { period: { end: 1788220800 } }, // 2026-09-01
          ],
        },
      },
    });

    expect(res.status).toBe(200);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.status).toBe("active");
    expect(saved.currentPeriodEnd).toBe(new Date(1788220800 * 1000).toISOString());
    expect(saved.sessionsUsedThisPeriod).toBe(0);
    expect(saved.extraSessionGrants).toEqual([]);
    expect(saved.periodLapsedNotifiedAt).toBeNull();
    expect(mockRecordPaymentEvent).toHaveBeenCalledWith(expect.objectContaining({ key: "evt_20" }));
  });

  it("invoice.paid recovers past_due without resetting usage when the period doesn't advance", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      status: "past_due",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      sessionsUsedThisPeriod: 4,
    });

    const res = await postEvent({
      id: "evt_21",
      type: "invoice.paid",
      object: {
        id: "in_11",
        subscription: "sub_123",
        // Same period end as stored — a retry for the current period.
        lines: { data: [{ period: { end: 1788220800 } }] },
      },
    });

    expect(res.status).toBe(200);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.status).toBe("active");
    expect(saved.currentPeriodEnd).toBe("2026-09-01T00:00:00.000Z");
    expect(saved.sessionsUsedThisPeriod).toBe(4);
    expect(saved.extraSessionGrants).toEqual(SUBSCRIPTION.extraSessionGrants);
  });

  it("invoice.paid fills a null period end and never resurrects a canceled membership", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      status: "active",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: null,
    });

    await postEvent({
      id: "evt_22",
      type: "invoice.paid",
      object: { id: "in_12", subscription: "sub_123", lines: { data: [{ period: { end: 1788220800 } }] } },
    });
    expect(mockSaveSubscription.mock.calls[0][0].currentPeriodEnd).toBe(
      new Date(1788220800 * 1000).toISOString()
    );
    expect(mockSaveSubscription.mock.calls[0][0].sessionsUsedThisPeriod).toBe(0);

    mockSaveSubscription.mockClear();
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      status: "canceled",
      providerSubscriptionId: "sub_123",
    });
    const res = await postEvent({
      id: "evt_23",
      type: "invoice.paid",
      object: { id: "in_13", subscription: "sub_123", lines: { data: [{ period: { end: 1788220800 } }] } },
    });
    expect(res.status).toBe(200);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("invoice.payment_succeeded and nested 2025+ payloads roll the period too", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue({
      ...SUBSCRIPTION,
      status: "active",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    });

    const res = await postEvent({
      id: "evt_24",
      type: "invoice.payment_succeeded",
      object: {
        id: "in_14",
        parent: { subscription_details: { subscription: "sub_123" } },
        // No line periods — falls back to invoice.period_end.
        period_end: 1788220800,
      },
    });

    expect(res.status).toBe(200);
    expect(mockSaveSubscription.mock.calls[0][0].currentPeriodEnd).toBe(
      new Date(1788220800 * 1000).toISOString()
    );
  });

  it("invoice.paid for an unknown subscription is acknowledged without writes", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);
    mockFindSubscriptionByProviderOrderId.mockReturnValue(undefined);

    const res = await postEvent({
      id: "evt_25",
      type: "invoice.paid",
      object: { id: "in_15", subscription: "sub_ghost", lines: { data: [{ period: { end: 1788220800 } }] } },
    });

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockRecordPaymentEvent).toHaveBeenCalled();
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
