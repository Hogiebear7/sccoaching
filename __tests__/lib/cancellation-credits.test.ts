import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreatePendingCancellationCredit,
  mockFindPendingCancellationCreditsByClassId,
  mockSavePendingCancellationCredit,
  mockFindSubscriptionByUserId,
  mockSaveSubscription,
  mockFindUserById,
  mockCreateNotification,
  mockHasConsumedPassForBooking,
  mockReversePassConsumption,
  mockSendPush,
} = vi.hoisted(() => ({
  mockCreatePendingCancellationCredit: vi.fn(),
  mockFindPendingCancellationCreditsByClassId: vi.fn(),
  mockSavePendingCancellationCredit: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockFindUserById: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockHasConsumedPassForBooking: vi.fn(),
  mockReversePassConsumption: vi.fn(),
  mockSendPush: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  createPendingCancellationCredit: mockCreatePendingCancellationCredit,
  findPendingCancellationCreditsByClassId: mockFindPendingCancellationCreditsByClassId,
  savePendingCancellationCredit: mockSavePendingCancellationCredit,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  saveSubscription: mockSaveSubscription,
  findUserById: mockFindUserById,
  createNotification: mockCreateNotification,
}));

vi.mock("@/lib/payments", () => ({
  hasConsumedPassForBooking: mockHasConsumedPassForBooking,
  reversePassConsumption: mockReversePassConsumption,
}));

vi.mock("@/lib/push", () => ({
  sendPush: mockSendPush,
}));

const SUBSCRIPTION = {
  userId: "user-1",
  planId: "plan-1",
  status: "active" as const,
  provider: "none" as const,
  providerCustomerId: null,
  providerSubscriptionId: null,
  currentPeriodEnd: null,
  lastWebhookEventAt: null,
  sessionsUsedThisPeriod: 5,
  extraSessionGrants: [],
  createdAt: "x",
  updatedAt: "x",
};

const MEMBER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

function pendingCredit(overrides: Record<string, unknown> = {}) {
  return {
    id: "pending-1",
    classId: "class-1",
    userId: "user-1",
    bookingId: "booking-1",
    creditSource: "subscription" as const,
    status: "pending" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUserById.mockReturnValue(MEMBER);
});

describe("creditSourceForBooking", () => {
  it("returns 'pass' when a pass was consumed for the booking", async () => {
    const { creditSourceForBooking } = await import("@/lib/cancellation-credits");
    mockHasConsumedPassForBooking.mockReturnValue(true);

    expect(creditSourceForBooking("booking-1", "user-1")).toBe("pass");
    expect(mockFindSubscriptionByUserId).not.toHaveBeenCalled();
  });

  it("returns 'subscription' when no pass was consumed but a subscription exists", async () => {
    const { creditSourceForBooking } = await import("@/lib/cancellation-credits");
    mockHasConsumedPassForBooking.mockReturnValue(false);
    mockFindSubscriptionByUserId.mockReturnValue(SUBSCRIPTION);

    expect(creditSourceForBooking("booking-1", "user-1")).toBe("subscription");
  });

  it("returns null when nothing was actually consumed", async () => {
    const { creditSourceForBooking } = await import("@/lib/cancellation-credits");
    mockHasConsumedPassForBooking.mockReturnValue(false);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);

    expect(creditSourceForBooking("booking-1", "user-1")).toBeNull();
  });
});

describe("resolvePendingCancellationCreditsForClass", () => {
  it("is a no-op when nothing is pending for the class", async () => {
    const { resolvePendingCancellationCreditsForClass } = await import("@/lib/cancellation-credits");
    mockFindPendingCancellationCreditsByClassId.mockReturnValue([]);

    resolvePendingCancellationCreditsForClass("class-1");

    expect(mockSavePendingCancellationCredit).not.toHaveBeenCalled();
    expect(mockReversePassConsumption).not.toHaveBeenCalled();
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("restores a pass-sourced credit via reversePassConsumption and notifies the member", async () => {
    const { resolvePendingCancellationCreditsForClass } = await import("@/lib/cancellation-credits");
    mockFindPendingCancellationCreditsByClassId.mockReturnValue([pendingCredit({ creditSource: "pass" })]);
    mockReversePassConsumption.mockReturnValue(true);

    resolvePendingCancellationCreditsForClass("class-1");

    expect(mockReversePassConsumption).toHaveBeenCalledWith("booking-1", expect.any(String));
    expect(mockSavePendingCancellationCredit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pending-1", status: "refilled" })
    );
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", type: "cancellation_credit_restored" })
    );
  });

  it("restores a subscription-sourced credit by decrementing sessionsUsedThisPeriod", async () => {
    const { resolvePendingCancellationCreditsForClass } = await import("@/lib/cancellation-credits");
    mockFindPendingCancellationCreditsByClassId.mockReturnValue([pendingCredit({ creditSource: "subscription" })]);
    mockFindSubscriptionByUserId.mockReturnValue(SUBSCRIPTION);

    resolvePendingCancellationCreditsForClass("class-1");

    expect(mockSaveSubscription).toHaveBeenCalledWith(expect.objectContaining({ sessionsUsedThisPeriod: 4 }));
    expect(mockReversePassConsumption).not.toHaveBeenCalled();
    expect(mockSavePendingCancellationCredit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pending-1", status: "refilled" })
    );
  });

  it("resolves only the oldest pending credit (FIFO), leaving newer ones untouched", async () => {
    const { resolvePendingCancellationCreditsForClass } = await import("@/lib/cancellation-credits");
    // findPendingCancellationCreditsByClassId is documented to return
    // oldest-first — the resolver trusts that ordering rather than re-sorting.
    mockFindPendingCancellationCreditsByClassId.mockReturnValue([
      pendingCredit({ id: "pending-oldest", createdAt: "2026-01-01T00:00:00.000Z" }),
      pendingCredit({ id: "pending-newer", createdAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    mockFindSubscriptionByUserId.mockReturnValue(SUBSCRIPTION);

    resolvePendingCancellationCreditsForClass("class-1");

    expect(mockSavePendingCancellationCredit).toHaveBeenCalledTimes(1);
    expect(mockSavePendingCancellationCredit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pending-oldest", status: "refilled" })
    );
  });

  it("still marks the credit refilled even if the underlying subscription no longer exists, but skips the notification", async () => {
    const { resolvePendingCancellationCreditsForClass } = await import("@/lib/cancellation-credits");
    mockFindPendingCancellationCreditsByClassId.mockReturnValue([pendingCredit({ creditSource: "subscription" })]);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);

    resolvePendingCancellationCreditsForClass("class-1");

    expect(mockSavePendingCancellationCredit).toHaveBeenCalledWith(
      expect.objectContaining({ status: "refilled" })
    );
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
