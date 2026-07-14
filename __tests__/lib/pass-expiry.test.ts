import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindPassLedgerByUserId, mockFindPassLedgerByPurchaseId, mockAppendPassLedgerEntry } =
  vi.hoisted(() => ({
    mockFindPassLedgerByUserId: vi.fn(),
    mockFindPassLedgerByPurchaseId: vi.fn(),
    mockAppendPassLedgerEntry: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  findPassLedgerByUserId: mockFindPassLedgerByUserId,
  findPassLedgerByPurchaseId: mockFindPassLedgerByPurchaseId,
  findPassLedgerByBookingId: vi.fn(() => []),
  findClassPassProductById: vi.fn(),
  appendPassLedgerEntry: mockAppendPassLedgerEntry,
  savePurchase: vi.fn(),
}));

import { applyPaidPassPurchase, purchasedPassBalance } from "@/lib/payments";

type Entry = {
  id: string;
  userId: string;
  delta: number;
  reason: "purchase" | "refund_reversal" | "consume" | "consume_reversal" | "staff_adjust";
  purchaseId: string | null;
  bookingId: string | null;
  expiresAt?: string | null;
  note: string | null;
  createdAt: string;
};

let seq = 0;
function entry(partial: Partial<Entry> & Pick<Entry, "delta" | "reason">): Entry {
  seq += 1;
  return {
    id: `led-${seq}`,
    userId: "user-1",
    purchaseId: null,
    bookingId: null,
    note: null,
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    ...partial,
  };
}

const NOW = new Date("2026-07-01T12:00:00.000Z");
const PAST = "2026-06-01T00:00:00.000Z";
const FUTURE = "2026-12-01T00:00:00.000Z";

describe("purchasedPassBalance with expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seq = 0;
  });

  it("matches the old sum-of-deltas exactly when nothing expires", () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      entry({ delta: 10, reason: "purchase", purchaseId: "p1" }),
      entry({ delta: -1, reason: "consume", bookingId: "b1" }),
      entry({ delta: -1, reason: "consume", bookingId: "b2" }),
      entry({ delta: 1, reason: "consume_reversal", bookingId: "b1" }),
      entry({ delta: 2, reason: "staff_adjust" }),
      entry({ delta: -10, reason: "refund_reversal", purchaseId: "p1" }),
    ]);
    // 10 - 1 - 1 + 1 + 2 - 10 = 1
    expect(purchasedPassBalance("user-1", NOW)).toBe(1);
  });

  it("forfeits the unused remainder of an expired purchase", () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      entry({ delta: 5, reason: "purchase", purchaseId: "p1", expiresAt: PAST }),
      entry({ delta: -1, reason: "consume", bookingId: "b1", createdAt: "2026-05-01T00:00:00.000Z" }),
    ]);
    // consumed 1 while valid; remaining 4 expired and are gone
    expect(purchasedPassBalance("user-1", NOW)).toBe(0);
  });

  it("keeps non-expiring and future-dated pools available", () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      entry({ delta: 5, reason: "purchase", purchaseId: "p1", expiresAt: PAST }),
      entry({ delta: 10, reason: "purchase", purchaseId: "p2", expiresAt: FUTURE }),
      entry({ delta: 3, reason: "purchase", purchaseId: "p3" }),
    ]);
    expect(purchasedPassBalance("user-1", NOW)).toBe(13);
  });

  it("spends the oldest usable pool first and skips pools already expired at consume time", () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      // p1 expired before the consume happened — the consume must hit p2.
      entry({ delta: 2, reason: "purchase", purchaseId: "p1", expiresAt: "2026-02-01T00:00:00.000Z" }),
      entry({ delta: 2, reason: "purchase", purchaseId: "p2", expiresAt: FUTURE }),
      entry({ delta: -1, reason: "consume", bookingId: "b1", createdAt: "2026-03-01T00:00:00.000Z" }),
    ]);
    // p1's 2 are forfeited; p2 has 1 left
    expect(purchasedPassBalance("user-1", NOW)).toBe(1);
  });

  it("returns a reversed consumption to the pool it came from", () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      entry({ delta: 1, reason: "purchase", purchaseId: "p1", expiresAt: FUTURE }),
      entry({ delta: -1, reason: "consume", bookingId: "b1" }),
      entry({ delta: 1, reason: "consume_reversal", bookingId: "b1" }),
    ]);
    expect(purchasedPassBalance("user-1", NOW)).toBe(1);
  });

  it("a refund debt is not forgiven by expiry", () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      entry({ delta: 5, reason: "purchase", purchaseId: "p1", expiresAt: PAST }),
      entry({ delta: -1, reason: "consume", bookingId: "b1", createdAt: "2026-05-01T00:00:00.000Z" }),
      entry({ delta: -1, reason: "consume", bookingId: "b2", createdAt: "2026-05-02T00:00:00.000Z" }),
      entry({ delta: -5, reason: "refund_reversal", purchaseId: "p1", createdAt: "2026-05-03T00:00:00.000Z" }),
    ]);
    // Pool: 5 - 2 consumed - 5 refunded = -2; expiry keeps negatives.
    expect(purchasedPassBalance("user-1", NOW)).toBe(-2);
  });

  it("staff grants never expire", () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      entry({ delta: 3, reason: "staff_adjust", createdAt: "2020-01-01T00:00:00.000Z" }),
    ]);
    expect(purchasedPassBalance("user-1", NOW)).toBe(3);
  });
});

describe("applyPaidPassPurchase expiry stamping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindPassLedgerByPurchaseId.mockReturnValue([]);
  });

  const PURCHASE = { id: "pur-1", userId: "user-1" } as never;

  it("stamps expiresAt validityDays after the credit", () => {
    const before = Date.now();
    applyPaidPassPurchase(PURCHASE, { passCount: 10, name: "Pack", validityDays: 90 });
    const written = mockAppendPassLedgerEntry.mock.calls[0][0];

    expect(written.expiresAt).toBeTruthy();
    const diffDays = (new Date(written.expiresAt).getTime() - before) / 86_400_000;
    expect(diffDays).toBeGreaterThan(89.9);
    expect(diffDays).toBeLessThan(90.1);
  });

  it("leaves expiresAt null when the product has no validity rule", () => {
    applyPaidPassPurchase(PURCHASE, { passCount: 10, name: "Pack", validityDays: null });
    expect(mockAppendPassLedgerEntry.mock.calls[0][0].expiresAt).toBeNull();

    mockAppendPassLedgerEntry.mockClear();
    applyPaidPassPurchase(PURCHASE, { passCount: 10, name: "Pack" });
    expect(mockAppendPassLedgerEntry.mock.calls[0][0].expiresAt).toBeNull();
  });
});
