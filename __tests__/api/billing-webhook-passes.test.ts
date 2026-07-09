import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindPurchaseByProviderOrderId,
  mockFindClassPassProductById,
  mockFindSubscriptionByProviderOrderId,
  mockHasPaymentEvent,
  mockRecordPaymentEvent,
  mockSavePurchase,
  mockAppendPassLedgerEntry,
  mockFindPassLedgerByPurchaseId,
} = vi.hoisted(() => ({
  mockFindPurchaseByProviderOrderId: vi.fn(),
  mockFindClassPassProductById: vi.fn(),
  mockFindSubscriptionByProviderOrderId: vi.fn(),
  mockHasPaymentEvent: vi.fn(),
  mockRecordPaymentEvent: vi.fn(),
  mockSavePurchase: vi.fn(),
  mockAppendPassLedgerEntry: vi.fn(),
  mockFindPassLedgerByPurchaseId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findPurchaseByProviderOrderId: mockFindPurchaseByProviderOrderId,
  findClassPassProductById: mockFindClassPassProductById,
  findSubscriptionByProviderOrderId: mockFindSubscriptionByProviderOrderId,
  findMembershipPlanById: vi.fn(),
  hasPaymentEvent: mockHasPaymentEvent,
  recordPaymentEvent: mockRecordPaymentEvent,
  savePurchase: mockSavePurchase,
  saveSubscription: vi.fn(),
  appendPassLedgerEntry: mockAppendPassLedgerEntry,
  findPassLedgerByPurchaseId: mockFindPassLedgerByPurchaseId,
  findPassLedgerByUserId: vi.fn(() => []),
}));

// Signature layer is unit-tested separately; here it always accepts so the
// business behavior under webhooks is what's exercised.
vi.mock("@/lib/providers/revolut-webhook", () => ({
  isRevolutWebhookConfigured: () => true,
  isRevolutTimestampFresh: () => true,
  verifyRevolutSignature: () => true,
  mapRevolutEventToStatus: (event: string) =>
    event === "ORDER_COMPLETED" ? "active" : null,
}));

const PURCHASE = {
  id: "pur-1",
  userId: "user-1",
  kind: "pass_pack" as const,
  productId: "pack-10",
  description: "10 Pass Pack — 10 class passes",
  amountCents: 12000,
  status: "pending" as const,
  provider: "revolut" as const,
  providerOrderId: "rev-order-1",
  checkoutUrl: "https://x",
  idempotencyKey: "user-1:pack-10",
  createdAt: "2026-07-09T10:00:00.000Z",
  updatedAt: "2026-07-09T10:00:00.000Z",
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

async function postWebhook(payload: unknown) {
  const { POST } = await import("@/app/api/billing/webhook/route");
  const request = new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "revolut-signature": "sig",
      "revolut-request-timestamp": String(Date.now()),
    },
    body: JSON.stringify(payload),
  });
  return POST(request);
}

describe("billing webhook — class pass purchases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindPurchaseByProviderOrderId.mockReturnValue(PURCHASE);
    mockFindClassPassProductById.mockReturnValue(PRODUCT);
    mockFindSubscriptionByProviderOrderId.mockReturnValue(undefined);
    mockHasPaymentEvent.mockReturnValue(false);
    mockFindPassLedgerByPurchaseId.mockReturnValue([]);
  });

  it("ORDER_COMPLETED marks the purchase paid and credits passes once", async () => {
    const res = await postWebhook({ event: "ORDER_COMPLETED", order_id: "rev-order-1" });

    expect(res.status).toBe(200);
    expect(mockSavePurchase.mock.calls[0][0]).toMatchObject({ id: "pur-1", status: "paid" });
    expect(mockAppendPassLedgerEntry).toHaveBeenCalledTimes(1);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      userId: "user-1",
      delta: 10,
      reason: "purchase",
      purchaseId: "pur-1",
    });
    expect(mockRecordPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ORDER_COMPLETED:rev-order-1" })
    );
  });

  it("replayed events are acknowledged but never re-applied", async () => {
    mockHasPaymentEvent.mockReturnValue(true);

    const res = await postWebhook({ event: "ORDER_COMPLETED", order_id: "rev-order-1" });

    expect(res.status).toBe(200);
    expect(mockSavePurchase).not.toHaveBeenCalled();
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
    expect(mockRecordPaymentEvent).not.toHaveBeenCalled();
  });

  it("a completed event on an already-refunded purchase applies nothing", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue({ ...PURCHASE, status: "refunded" });

    const res = await postWebhook({ event: "ORDER_COMPLETED", order_id: "rev-order-1" });

    expect(res.status).toBe(200);
    expect(mockSavePurchase).not.toHaveBeenCalled();
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
    // Still recorded so the same replay short-circuits next time
    expect(mockRecordPaymentEvent).toHaveBeenCalled();
  });

  it("declined and cancelled payments transition without crediting", async () => {
    await postWebhook({ event: "ORDER_PAYMENT_DECLINED", order_id: "rev-order-1" });
    expect(mockSavePurchase.mock.calls[0][0].status).toBe("failed");
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();

    mockSavePurchase.mockClear();
    await postWebhook({ event: "ORDER_CANCELLED", order_id: "rev-order-1" });
    expect(mockSavePurchase.mock.calls[0][0].status).toBe("cancelled");
  });

  it("ORDER_REFUNDED on a paid purchase writes the compensating ledger entry", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue({ ...PURCHASE, status: "paid" });
    mockFindPassLedgerByPurchaseId.mockReturnValue([
      { id: "led-1", userId: "user-1", delta: 10, reason: "purchase", purchaseId: "pur-1", note: null, createdAt: "x" },
    ]);

    const res = await postWebhook({ event: "ORDER_REFUNDED", order_id: "rev-order-1" });

    expect(res.status).toBe(200);
    expect(mockSavePurchase.mock.calls[0][0].status).toBe("refunded");
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      delta: -10,
      reason: "refund_reversal",
    });
  });

  it("orders that aren't pass purchases fall through to the subscription path", async () => {
    mockFindPurchaseByProviderOrderId.mockReturnValue(undefined);

    const res = await postWebhook({ event: "ORDER_COMPLETED", order_id: "sub-order-9" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toContain("No matching subscription");
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
  });
});
