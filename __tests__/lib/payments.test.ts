import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAppendPassLedgerEntry,
  mockFindPassLedgerByBookingId,
  mockFindPassLedgerByPurchaseId,
  mockFindPassLedgerByUserId,
  mockFindUserById,
  mockSavePurchase,
} = vi.hoisted(() => ({
  mockAppendPassLedgerEntry: vi.fn(),
  mockFindPassLedgerByBookingId: vi.fn(),
  mockFindPassLedgerByPurchaseId: vi.fn(),
  mockFindPassLedgerByUserId: vi.fn(),
  mockFindUserById: vi.fn(),
  mockSavePurchase: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  appendPassLedgerEntry: mockAppendPassLedgerEntry,
  findPassLedgerByBookingId: mockFindPassLedgerByBookingId,
  findPassLedgerByPurchaseId: mockFindPassLedgerByPurchaseId,
  findPassLedgerByUserId: mockFindPassLedgerByUserId,
  findUserById: mockFindUserById,
  savePurchase: mockSavePurchase,
}));

import {
  applyPaidPassPurchase,
  applyRefundedPassPurchase,
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
  ownerGym: { scope: "gym", gymId: "gym-a" },
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
  mockFindUserById.mockReturnValue({ id: "user-1", gymId: null });
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

  it("copies the purchase's ownerGym onto the credit entry", () => {
    applyPaidPassPurchase(PURCHASE, PRODUCT);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0].ownerGym).toEqual({ scope: "gym", gymId: "gym-a" });
  });

  it("falls back to unresolved for a purchase written before ownerGym existed", () => {
    const legacyPurchase = { ...PURCHASE, ownerGym: undefined };
    applyPaidPassPurchase(legacyPurchase, PRODUCT);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0].ownerGym).toEqual({ scope: "unresolved" });
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

  it("copies the ORIGINAL credit's ownerGym, not re-derived from the purchase again", () => {
    // The original credit carries a different gym than the purchase itself
    // would resolve to now — proves the reversal nets to zero against the
    // exact row it corrects, not a freshly re-derived value.
    mockFindPassLedgerByPurchaseId.mockReturnValue([
      { ...purchaseCredit(), ownerGym: { scope: "gym", gymId: "gym-original" } },
    ]);
    applyRefundedPassPurchase(PURCHASE);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0].ownerGym).toEqual({ scope: "gym", gymId: "gym-original" });
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

  it("derives ownerGym from the CONSUMING member's own current gym, looked up server-side", () => {
    mockFindUserById.mockReturnValue({ id: "user-1", gymId: "gym-current" });
    mockFindPassLedgerByUserId.mockReturnValue([{ id: "led-1", userId: "user-1", delta: 5, reason: "purchase", purchaseId: "p-1", bookingId: null, note: null, createdAt: "2026-01-01T00:00:00.000Z" }]);
    consumePurchasedPass({ userId: "user-1", bookingId: "bk-1" });
    expect(mockFindUserById).toHaveBeenCalledWith("user-1");
    expect(mockAppendPassLedgerEntry.mock.calls[0][0].ownerGym).toEqual({ scope: "gym", gymId: "gym-current" });
  });

  it("marks a consume entry unresolved if the user has vanished between the balance check and the write", () => {
    mockFindUserById.mockReturnValue(undefined);
    mockFindPassLedgerByUserId.mockReturnValue([{ id: "led-1", userId: "user-1", delta: 5, reason: "purchase", purchaseId: "p-1", bookingId: null, note: null, createdAt: "2026-01-01T00:00:00.000Z" }]);
    consumePurchasedPass({ userId: "user-1", bookingId: "bk-1" });
    expect(mockAppendPassLedgerEntry.mock.calls[0][0].ownerGym).toEqual({ scope: "unresolved" });
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
    mockFindPassLedgerByBookingId.mockReturnValue([{ ...consumeEntry(), ownerGym: { scope: "gym", gymId: "gym-at-consume-time" } }]);
    expect(reversePassConsumption("bk-1")).toBe(true);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      delta: 1,
      reason: "consume_reversal",
      // Copies the ORIGINAL consume entry's ownerGym, not the member's
      // current gym — the reversal nets to zero against the exact row.
      ownerGym: { scope: "gym", gymId: "gym-at-consume-time" },
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
