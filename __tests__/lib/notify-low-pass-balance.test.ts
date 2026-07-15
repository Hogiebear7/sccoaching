import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindMembers,
  mockFindSubscriptionByUserId,
  mockFindMembershipPlanById,
  mockFindNotificationByDedupeKey,
  mockCreateNotification,
  mockFindPassLedgerByUserId,
  mockFindProfileByUserId,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockFindMembers: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
  mockFindNotificationByDedupeKey: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockFindPassLedgerByUserId: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findMembers: mockFindMembers,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findMembershipPlanById: mockFindMembershipPlanById,
  findNotificationByDedupeKey: mockFindNotificationByDedupeKey,
  createNotification: mockCreateNotification,
  findPassLedgerByUserId: mockFindPassLedgerByUserId,
  findProfileByUserId: mockFindProfileByUserId,
  findPurchasesByUserId: vi.fn(() => []),
  findPassLedgerByPurchaseId: vi.fn(() => []),
  findPassLedgerByBookingId: vi.fn(() => []),
  findClassPassProductById: vi.fn(),
  appendPassLedgerEntry: vi.fn(),
  savePurchase: vi.fn(),
}));

vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }));

import { notifyLowPassBalanceJob } from "@/lib/jobs/notify-low-pass-balance";

const MEMBER = { id: "member-1", email: "alex@example.com", role: "member" as const };

const FUTURE = new Date(Date.now() + 14 * 86_400_000).toISOString();

const PLAN = { monthlySessionAllowance: 8 };

function activeSub(used: number) {
  return {
    userId: "member-1",
    planId: "plan-1",
    status: "active" as const,
    currentPeriodEnd: FUTURE,
    sessionsUsedThisPeriod: used,
    extraSessionGrants: [],
  };
}

function credit(delta: number, id: string, expiresAt: string | null = null) {
  return {
    id,
    userId: "member-1",
    delta,
    reason: "purchase" as const,
    purchaseId: `p-${id}`,
    bookingId: null,
    expiresAt,
    note: null,
    createdAt: `2026-06-01T00:00:0${id.length}.000Z`,
  };
}

describe("notify-low-pass-balance job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMembers.mockReturnValue([MEMBER]);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockFindMembershipPlanById.mockReturnValue(undefined);
    mockFindNotificationByDedupeKey.mockReturnValue(undefined);
    mockFindPassLedgerByUserId.mockReturnValue([]);
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: true,
    });
  });

  it("fires the matching threshold with in-app + email at 3, 2 and 1", async () => {
    for (const used of [5, 6, 7]) {
      vi.clearAllMocks();
      mockFindMembers.mockReturnValue([MEMBER]);
      mockFindSubscriptionByUserId.mockReturnValue(activeSub(used));
      mockFindMembershipPlanById.mockReturnValue(PLAN);
      mockFindNotificationByDedupeKey.mockReturnValue(undefined);
      mockFindPassLedgerByUserId.mockReturnValue([]);
      mockFindProfileByUserId.mockReturnValue({
        email: "alex@example.com",
        fullName: "Alex",
        emailNotificationsEnabled: true,
      });

      const remaining = 8 - used;
      const summary = await notifyLowPassBalanceJob.run();

      expect(summary).toContain("Warned 1 member");
      const notif = mockCreateNotification.mock.calls[0][0];
      expect(notif.title).toBe(
        `You have ${remaining} class pass${remaining === 1 ? "" : "es"} remaining`
      );
      expect(notif.dedupeKey).toContain(`pass-low:${remaining}:`);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "alex@example.com",
          subject: expect.stringContaining(`${remaining} class pass`),
        })
      );
    }
  });

  it("stays silent at 4+ remaining and at zero", async () => {
    for (const used of [4, 8]) {
      mockFindSubscriptionByUserId.mockReturnValue(activeSub(used));
      mockFindMembershipPlanById.mockReturnValue(PLAN);
      const summary = await notifyLowPassBalanceJob.run();
      expect(summary).toBe("No members with a low pass balance to warn.");
    }
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("never repeats a threshold within the same balance episode", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSub(6));
    mockFindMembershipPlanById.mockReturnValue(PLAN);
    mockFindNotificationByDedupeKey.mockReturnValue({ id: "already" });

    const summary = await notifyLowPassBalanceJob.run();

    expect(summary).toBe("No members with a low pass balance to warn.");
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("a new credit re-arms the thresholds (episode marker changes)", async () => {
    // First run-down: plan has 2 left, no pack history.
    mockFindSubscriptionByUserId.mockReturnValue(activeSub(6));
    mockFindMembershipPlanById.mockReturnValue(PLAN);
    mockFindPassLedgerByUserId.mockReturnValue([]);

    await notifyLowPassBalanceJob.run();
    const firstKey = mockCreateNotification.mock.calls[0][0].dedupeKey;

    // Later: the member bought a pack (new positive credit) and ran it back
    // down to the same usable total — the marker must differ so the warning
    // fires again for the new run-down.
    vi.clearAllMocks();
    mockFindMembers.mockReturnValue([MEMBER]);
    mockFindSubscriptionByUserId.mockReturnValue(activeSub(8)); // plan exhausted
    mockFindMembershipPlanById.mockReturnValue(PLAN);
    mockFindNotificationByDedupeKey.mockReturnValue(undefined);
    mockFindProfileByUserId.mockReturnValue({ email: "a@b.c", fullName: "Alex" });
    mockFindPassLedgerByUserId.mockReturnValue([
      credit(5, "newpack"),
      { id: "c1", userId: "member-1", delta: -1, reason: "consume" as const, purchaseId: null, bookingId: "b1", note: null, createdAt: "2026-06-03T00:00:00.000Z" },
      { id: "c2", userId: "member-1", delta: -1, reason: "consume" as const, purchaseId: null, bookingId: "b2", note: null, createdAt: "2026-06-04T00:00:00.000Z" },
      { id: "c3", userId: "member-1", delta: -1, reason: "consume" as const, purchaseId: null, bookingId: "b3", note: null, createdAt: "2026-06-05T00:00:00.000Z" },
    ]);

    await notifyLowPassBalanceJob.run();
    const secondKey = mockCreateNotification.mock.calls[0][0].dedupeKey;
    // Same threshold (2 remaining) but a different episode.
    expect(secondKey).toContain("pass-low:2:");
    expect(secondKey).not.toBe(firstKey);
  });

  it("expired pack passes don't count toward the usable balance", async () => {
    // No plan; a 5-pass pack that expired yesterday and 2 usable staff-granted passes.
    const past = new Date(Date.now() - 86_400_000).toISOString();
    mockFindPassLedgerByUserId.mockReturnValue([
      credit(5, "a", past),
      {
        id: "grant",
        userId: "member-1",
        delta: 2,
        reason: "staff_adjust" as const,
        purchaseId: null,
        bookingId: null,
        note: null,
        createdAt: "2026-06-02T00:00:00.000Z",
      },
    ]);

    const summary = await notifyLowPassBalanceJob.run();

    // Usable = 2 (the expired 5 are forfeited) → the 2-remaining warning.
    expect(summary).toContain("Warned 1 member");
    expect(mockCreateNotification.mock.calls[0][0].title).toContain("2 class passes");
  });

  it("skips archived members and unlimited plans", async () => {
    mockFindMembers.mockReturnValue([{ ...MEMBER, archivedAt: "2026-07-01T00:00:00.000Z" }]);
    mockFindSubscriptionByUserId.mockReturnValue(activeSub(7));
    mockFindMembershipPlanById.mockReturnValue(PLAN);
    expect(await notifyLowPassBalanceJob.run()).toBe("No members with a low pass balance to warn.");

    mockFindMembers.mockReturnValue([MEMBER]);
    mockFindMembershipPlanById.mockReturnValue({ monthlySessionAllowance: null });
    expect(await notifyLowPassBalanceJob.run()).toBe("No members with a low pass balance to warn.");
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("respects the member's email opt-out but still notifies in-app", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSub(6));
    mockFindMembershipPlanById.mockReturnValue(PLAN);
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: false,
    });

    await notifyLowPassBalanceJob.run();

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
