import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAppendPassLedgerEntry,
  mockFindClassPassProductById,
  mockFindPassLedgerByBookingId,
  mockFindPassLedgerByPurchaseId,
  mockFindPassLedgerByUserId,
  mockSavePurchase,
} = vi.hoisted(() => ({
  mockAppendPassLedgerEntry: vi.fn(),
  mockFindClassPassProductById: vi.fn(),
  mockFindPassLedgerByBookingId: vi.fn(),
  mockFindPassLedgerByPurchaseId: vi.fn(),
  mockFindPassLedgerByUserId: vi.fn(),
  mockSavePurchase: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  appendPassLedgerEntry: mockAppendPassLedgerEntry,
  findClassPassProductById: mockFindClassPassProductById,
  findPassLedgerByBookingId: mockFindPassLedgerByBookingId,
  findPassLedgerByPurchaseId: mockFindPassLedgerByPurchaseId,
  findPassLedgerByUserId: mockFindPassLedgerByUserId,
  savePurchase: mockSavePurchase,
}));

import {
  applyPaidPassPurchase,
  applyRefundedPassPurchase,
  buildPassPackPurchase,
  canTransitionPurchase,
  consumePurchasedPass,
  purchasedPassBalance,
  reversePassConsumption,
  transitionPurchase,
} from "@/lib/payments";
import type { PurchaseRecord } from "@/lib/db";

const PURCHASE: PurchaseRecord = {
  id: "pur-1",
  userId: "user-1",
  kind: "pass_pack",
  productId: "pack-10",
  description: "10 Pass Pack — 10 class passes",
  amountCents: 12000,
  status: "pending",
  provider: "revolut",
  providerOrderId: "rev-order-1",
  providerPaymentRef: null,
  checkoutUrl: "https://checkout.example/x",
  idempotencyKey: "user-1:pack-10",
  createdAt: "2026-07-09T10:00:00.000Z",
  updatedAt: "2026-07-09T10:00:00.000Z",
};

const PRODUCT = { name: "10 Pass Pack", passCount: 10 };

function purchaseCredit() {
  return {
    id: "led-1",
    userId: "user-1",
    delta: 10,
    reason: "purchase" as const,
    purchaseId: "pur-1",
    note: null,
    createdAt: "2026-07-09T10:05:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindPassLedgerByPurchaseId.mockReturnValue([]);
  mockFindPassLedgerByUserId.mockReturnValue([]);
  mockFindPassLedgerByBookingId.mockReturnValue([]);
});

describe("purchase state machine", () => {
  it("allows only legal transitions", () => {
    expect(canTransitionPurchase("pending", "paid")).toBe(true);
    expect(canTransitionPurchase("pending", "failed")).toBe(true);
    expect(canTransitionPurchase("pending", "cancelled")).toBe(true);
    expect(canTransitionPurchase("paid", "refunded")).toBe(true);

    expect(canTransitionPurchase("paid", "paid")).toBe(false);
    expect(canTransitionPurchase("refunded", "paid")).toBe(false);
    expect(canTransitionPurchase("failed", "paid")).toBe(false);
    expect(canTransitionPurchase("cancelled", "paid")).toBe(false);
    expect(canTransitionPurchase("pending", "refunded")).toBe(false);
  });

  it("persists legal transitions and rejects illegal ones without writing", () => {
    const paid = transitionPurchase(PURCHASE, "paid");
    expect(paid?.status).toBe("paid");
    expect(mockSavePurchase).toHaveBeenCalledTimes(1);

    mockSavePurchase.mockClear();
    expect(transitionPurchase({ ...PURCHASE, status: "refunded" }, "paid")).toBeNull();
    expect(mockSavePurchase).not.toHaveBeenCalled();
  });
});

describe("applyPaidPassPurchase", () => {
  it("credits the pack exactly once", () => {
    expect(applyPaidPassPurchase(PURCHASE, PRODUCT)).toBe(true);
    expect(mockAppendPassLedgerEntry).toHaveBeenCalledTimes(1);
    const entry = mockAppendPassLedgerEntry.mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: "user-1",
      delta: 10,
      reason: "purchase",
      purchaseId: "pur-1",
    });
  });

  it("no-ops when a credit for this purchase already exists (webhook replay)", () => {
    mockFindPassLedgerByPurchaseId.mockReturnValue([purchaseCredit()]);
    expect(applyPaidPassPurchase(PURCHASE, PRODUCT)).toBe(false);
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
  });
});

describe("applyRefundedPassPurchase", () => {
  it("writes one compensating entry, only if a credit exists", () => {
    // No credit yet → nothing to reverse
    expect(applyRefundedPassPurchase(PURCHASE)).toBe(false);
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();

    // Credit exists → reversal written with the negated delta
    mockFindPassLedgerByPurchaseId.mockReturnValue([purchaseCredit()]);
    expect(applyRefundedPassPurchase(PURCHASE)).toBe(true);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      delta: -10,
      reason: "refund_reversal",
      purchaseId: "pur-1",
    });

    // Reversal already present → replay no-ops
    mockAppendPassLedgerEntry.mockClear();
    mockFindPassLedgerByPurchaseId.mockReturnValue([
      purchaseCredit(),
      { ...purchaseCredit(), id: "led-2", delta: -10, reason: "refund_reversal" as const },
    ]);
    expect(applyRefundedPassPurchase(PURCHASE)).toBe(false);
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
  });
});

describe("purchasedPassBalance", () => {
  it("sums the ledger, including negative balances after refunds", () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      { id: "led-1", userId: "user-1", delta: 10, reason: "purchase", purchaseId: "p-1", bookingId: null, note: null, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "led-c2", userId: "user-1", delta: -1, reason: "consume", purchaseId: null, bookingId: "bk-2", note: null, createdAt: "2026-01-02T01:00:00.000Z" },
      { id: "led-c3", userId: "user-1", delta: -1, reason: "consume", purchaseId: null, bookingId: "bk-3", note: null, createdAt: "2026-01-03T01:00:00.000Z" },
    ]);
    expect(purchasedPassBalance("user-1")).toBe(8);

    mockFindPassLedgerByUserId.mockReturnValue([{ id: "led-1", userId: "user-1", delta: 10, reason: "purchase", purchaseId: "p-1", bookingId: null, note: null, createdAt: "2026-01-01T00:00:00.000Z" }, { id: "led-r2", userId: "user-1", delta: -10, reason: "refund_reversal", purchaseId: "p-1", bookingId: null, note: null, createdAt: "2026-01-02T02:00:00.000Z" }, { id: "led-c3", userId: "user-1", delta: -1, reason: "consume", purchaseId: null, bookingId: "bk-3", note: null, createdAt: "2026-01-03T01:00:00.000Z" }, { id: "led-c4", userId: "user-1", delta: -1, reason: "consume", purchaseId: null, bookingId: "bk-4", note: null, createdAt: "2026-01-04T01:00:00.000Z" }]);
    expect(purchasedPassBalance("user-1")).toBe(-2);
  });
});

describe("buildPassPackPurchase", () => {
  it("creates a pending purchase bound to member, product, and key", () => {
    const purchase = buildPassPackPurchase({
      userId: "user-9",
      product: {
        id: "pack-5",
        name: "5 Pass Pack",
        description: null,
        passCount: 5,
        priceCents: 6500,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      idempotencyKey: "user-9:pack-5",
      provider: "stripe",
    });
    expect(purchase).toMatchObject({
      userId: "user-9",
      kind: "pass_pack",
      productId: "pack-5",
      amountCents: 6500,
      status: "pending",
      providerOrderId: null,
      idempotencyKey: "user-9:pack-5",
      provider: "stripe",
    });
  });
});

describe("consumePurchasedPass / reversePassConsumption", () => {
  function consumeEntry() {
    return {
      id: "led-c1",
      userId: "user-1",
      delta: -1,
      reason: "consume" as const,
      purchaseId: null,
      bookingId: "bk-1",
      note: null,
      createdAt: "2026-07-10T09:00:00.000Z",
    };
  }

  it("spends one pass keyed to the booking", () => {
    mockFindPassLedgerByUserId.mockReturnValue([{ id: "led-1", userId: "user-1", delta: 5, reason: "purchase", purchaseId: "p-1", bookingId: null, note: null, createdAt: "2026-01-01T00:00:00.000Z" }]);
    expect(consumePurchasedPass({ userId: "user-1", bookingId: "bk-1" })).toBe(true);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      userId: "user-1",
      delta: -1,
      reason: "consume",
      bookingId: "bk-1",
    });
  });

  it("refuses with no balance and never double-consumes the same booking", () => {
    mockFindPassLedgerByUserId.mockReturnValue([]);
    expect(consumePurchasedPass({ userId: "user-1", bookingId: "bk-1" })).toBe(false);

    mockFindPassLedgerByUserId.mockReturnValue([{ id: "led-1", userId: "user-1", delta: 5, reason: "purchase", purchaseId: "p-1", bookingId: null, note: null, createdAt: "2026-01-01T00:00:00.000Z" }]);
    mockFindPassLedgerByBookingId.mockReturnValue([consumeEntry()]);
    expect(consumePurchasedPass({ userId: "user-1", bookingId: "bk-1" })).toBe(false);
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
  });

  it("reverses a consumption exactly once, and only if it happened", () => {
    // nothing consumed → nothing to reverse
    expect(reversePassConsumption("bk-1")).toBe(false);

    // consumed → one compensating +1
    mockFindPassLedgerByBookingId.mockReturnValue([consumeEntry()]);
    expect(reversePassConsumption("bk-1")).toBe(true);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      delta: 1,
      reason: "consume_reversal",
      bookingId: "bk-1",
    });

    // retry → already reversed, no second entry
    mockAppendPassLedgerEntry.mockClear();
    mockFindPassLedgerByBookingId.mockReturnValue([
      consumeEntry(),
      { ...consumeEntry(), id: "led-c2", delta: 1, reason: "consume_reversal" as const },
    ]);
    expect(reversePassConsumption("bk-1")).toBe(false);
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
  });
});
