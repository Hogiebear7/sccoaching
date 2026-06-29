import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindAllSubscriptions,
  mockSaveSubscription,
  mockFindAnyStaffUser,
  mockFindMembershipPlanById,
  mockCreateMessage,
  mockFindAllWaitlistEntries,
  mockFindClassById,
  mockDeleteWaitlistEntry,
  mockPurgeExpiredResetTokens,
} = vi.hoisted(() => ({
  mockFindAllSubscriptions: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockFindAnyStaffUser: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockFindAllWaitlistEntries: vi.fn(),
  mockFindClassById: vi.fn(),
  mockDeleteWaitlistEntry: vi.fn(),
  mockPurgeExpiredResetTokens: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findAllSubscriptions: mockFindAllSubscriptions,
  saveSubscription: mockSaveSubscription,
  findAnyStaffUser: mockFindAnyStaffUser,
  findMembershipPlanById: mockFindMembershipPlanById,
  createMessage: mockCreateMessage,
  findAllWaitlistEntries: mockFindAllWaitlistEntries,
  findClassById: mockFindClassById,
  deleteWaitlistEntry: mockDeleteWaitlistEntry,
  purgeExpiredResetTokens: mockPurgeExpiredResetTokens,
}));

const STALE_UPDATED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
const FRESH_UPDATED_AT = new Date().toISOString();

function pendingSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "user-1",
    planId: "plan-1",
    status: "pending",
    provider: "none",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: null,
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 0,
    periodLapsedNotifiedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: STALE_UPDATED_AT,
    ...overrides,
  };
}

describe("expireStaleCheckoutsJob", () => {
  beforeEach(() => {
    mockFindAllSubscriptions.mockReset();
    mockSaveSubscription.mockReset();
  });

  it("flips a stale pending subscription to inactive", async () => {
    mockFindAllSubscriptions.mockReturnValue([pendingSubscription()]);
    const { expireStaleCheckoutsJob } = await import("@/lib/jobs/expire-stale-checkouts");

    const summary = await expireStaleCheckoutsJob.run();

    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    expect(mockSaveSubscription.mock.calls[0][0].status).toBe("inactive");
    expect(summary).toMatch(/expired 1/i);
  });

  it("leaves a recent pending subscription alone", async () => {
    mockFindAllSubscriptions.mockReturnValue([pendingSubscription({ updatedAt: FRESH_UPDATED_AT })]);
    const { expireStaleCheckoutsJob } = await import("@/lib/jobs/expire-stale-checkouts");

    const summary = await expireStaleCheckoutsJob.run();

    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(summary).toMatch(/no stale/i);
  });

  it("ignores non-pending subscriptions entirely", async () => {
    mockFindAllSubscriptions.mockReturnValue([pendingSubscription({ status: "active" })]);
    const { expireStaleCheckoutsJob } = await import("@/lib/jobs/expire-stale-checkouts");

    await expireStaleCheckoutsJob.run();

    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });
});

function activeLapsedSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "user-1",
    planId: "plan-1",
    status: "active",
    provider: "none",
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 0,
    periodLapsedNotifiedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("notifyLapsedMembershipsJob", () => {
  beforeEach(() => {
    mockFindAllSubscriptions.mockReset();
    mockSaveSubscription.mockReset();
    mockFindAnyStaffUser.mockReset();
    mockFindMembershipPlanById.mockReset();
    mockCreateMessage.mockReset();
    mockFindAnyStaffUser.mockReturnValue({ id: "staff-1", email: "coach@example.com", role: "staff" });
    mockFindMembershipPlanById.mockReturnValue({ id: "plan-1", name: "Premium" });
  });

  it("notifies a newly-lapsed active subscription and marks it notified", async () => {
    mockFindAllSubscriptions.mockReturnValue([activeLapsedSubscription()]);
    const { notifyLapsedMembershipsJob } = await import("@/lib/jobs/notify-lapsed-memberships");

    const summary = await notifyLapsedMembershipsJob.run();

    expect(mockCreateMessage).toHaveBeenCalledTimes(1);
    expect(mockCreateMessage.mock.calls[0][0].memberId).toBe("user-1");
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    expect(mockSaveSubscription.mock.calls[0][0].periodLapsedNotifiedAt).not.toBeNull();
    expect(summary).toMatch(/notified 1/i);
  });

  it("does not re-notify an already-notified lapse", async () => {
    mockFindAllSubscriptions.mockReturnValue([
      activeLapsedSubscription({ periodLapsedNotifiedAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    const { notifyLapsedMembershipsJob } = await import("@/lib/jobs/notify-lapsed-memberships");

    await notifyLapsedMembershipsJob.run();

    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("skips a non-lapsed active subscription", async () => {
    mockFindAllSubscriptions.mockReturnValue([
      activeLapsedSubscription({ currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }),
    ]);
    const { notifyLapsedMembershipsJob } = await import("@/lib/jobs/notify-lapsed-memberships");

    await notifyLapsedMembershipsJob.run();

    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("skips gracefully when there's no staff account to send from", async () => {
    mockFindAnyStaffUser.mockReturnValue(undefined);
    mockFindAllSubscriptions.mockReturnValue([activeLapsedSubscription()]);
    const { notifyLapsedMembershipsJob } = await import("@/lib/jobs/notify-lapsed-memberships");

    const summary = await notifyLapsedMembershipsJob.run();

    expect(mockCreateMessage).not.toHaveBeenCalled();
    expect(summary).toMatch(/skipped/i);
  });
});

describe("cleanupPastWaitlistsJob", () => {
  beforeEach(() => {
    mockFindAllWaitlistEntries.mockReset();
    mockFindClassById.mockReset();
    mockDeleteWaitlistEntry.mockReset();
  });

  it("removes a waitlist entry for a class that already started", async () => {
    mockFindAllWaitlistEntries.mockReturnValue([{ id: "wl-1", classId: "class-1", userId: "user-1", createdAt: "now" }]);
    mockFindClassById.mockReturnValue({
      id: "class-1",
      date: "2020-01-01",
      startTime: "09:00",
      capacity: 10,
    });
    const { cleanupPastWaitlistsJob } = await import("@/lib/jobs/cleanup-past-waitlists");

    const summary = await cleanupPastWaitlistsJob.run();

    expect(mockDeleteWaitlistEntry).toHaveBeenCalledWith("wl-1");
    expect(summary).toMatch(/removed 1/i);
  });

  it("removes a waitlist entry whose class no longer exists", async () => {
    mockFindAllWaitlistEntries.mockReturnValue([{ id: "wl-1", classId: "deleted-class", userId: "user-1", createdAt: "now" }]);
    mockFindClassById.mockReturnValue(undefined);
    const { cleanupPastWaitlistsJob } = await import("@/lib/jobs/cleanup-past-waitlists");

    await cleanupPastWaitlistsJob.run();

    expect(mockDeleteWaitlistEntry).toHaveBeenCalledWith("wl-1");
  });

  it("leaves a waitlist entry for a future class alone", async () => {
    mockFindAllWaitlistEntries.mockReturnValue([{ id: "wl-1", classId: "class-1", userId: "user-1", createdAt: "now" }]);
    mockFindClassById.mockReturnValue({
      id: "class-1",
      date: "2026-12-25",
      startTime: "09:00",
      capacity: 10,
    });
    const { cleanupPastWaitlistsJob } = await import("@/lib/jobs/cleanup-past-waitlists");

    const summary = await cleanupPastWaitlistsJob.run();

    expect(mockDeleteWaitlistEntry).not.toHaveBeenCalled();
    expect(summary).toMatch(/no stale/i);
  });
});

describe("purgeExpiredResetTokensJob", () => {
  beforeEach(() => {
    mockPurgeExpiredResetTokens.mockReset();
  });

  it("reports the purged count", async () => {
    mockPurgeExpiredResetTokens.mockReturnValue(3);
    const { purgeExpiredResetTokensJob } = await import("@/lib/jobs/purge-expired-reset-tokens");

    const summary = await purgeExpiredResetTokensJob.run();

    expect(summary).toMatch(/purged 3/i);
  });

  it("reports nothing to purge", async () => {
    mockPurgeExpiredResetTokens.mockReturnValue(0);
    const { purgeExpiredResetTokensJob } = await import("@/lib/jobs/purge-expired-reset-tokens");

    const summary = await purgeExpiredResetTokensJob.run();

    expect(summary).toMatch(/no expired/i);
  });
});
