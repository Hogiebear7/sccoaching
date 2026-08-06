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
  mockCreateNotification,
  mockFindProfileByUserId,
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
  mockCreateNotification: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
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
  createNotification: mockCreateNotification,
  findProfileByUserId: mockFindProfileByUserId,
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
    extraSessionGrants: [],
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

  it("clears an abandoned stale switch without touching the active membership", async () => {
    mockFindAllSubscriptions.mockReturnValue([
      pendingSubscription({
        status: "active",
        packageId: "pkg_old",
        billingOptionId: "opt_old",
        updatedAt: FRESH_UPDATED_AT,
        pendingPackageId: "pkg_new",
        pendingBillingOptionId: "opt_new",
        pendingSetupOrderId: "cs_abandoned",
        pendingStartedAt: STALE_UPDATED_AT,
      }),
    ]);
    const { expireStaleCheckoutsJob } = await import("@/lib/jobs/expire-stale-checkouts");

    const summary = await expireStaleCheckoutsJob.run();

    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    const saved = mockSaveSubscription.mock.calls[0][0];
    // Active membership untouched.
    expect(saved.status).toBe("active");
    expect(saved.billingOptionId).toBe("opt_old");
    // Pending switch cleared.
    expect(saved.pendingPackageId).toBeNull();
    expect(saved.pendingBillingOptionId).toBeNull();
    expect(saved.pendingSetupOrderId).toBeNull();
    expect(saved.pendingStartedAt).toBeNull();
    expect(summary).toMatch(/cleared 1 abandoned switch/i);
  });

  it("leaves a fresh in-flight switch alone", async () => {
    mockFindAllSubscriptions.mockReturnValue([
      pendingSubscription({
        status: "active",
        updatedAt: FRESH_UPDATED_AT,
        pendingBillingOptionId: "opt_new",
        pendingSetupOrderId: "cs_inflight",
        pendingStartedAt: FRESH_UPDATED_AT,
      }),
    ]);
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
    extraSessionGrants: [],
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

describe("resumePausedMembershipsJob", () => {
  beforeEach(() => {
    mockFindAllSubscriptions.mockReset();
    mockSaveSubscription.mockReset();
  });

  function pausedSubscription(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      userId: "user-1",
      packageId: "pkg-1",
      status: "paused",
      statusBeforePause: "active",
      pausedUntil: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago — due
      provider: "stripe",
      providerCustomerId: null,
      providerSubscriptionId: "sub_123",
      providerSetupOrderId: null,
      currentPeriodEnd: null,
      lastWebhookEventAt: null,
      sessionsUsedThisPeriod: 0,
      extraSessionGrants: [],
      periodLapsedNotifiedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("resumes a paused membership once its pause period has passed", async () => {
    mockFindAllSubscriptions.mockReturnValue([pausedSubscription()]);
    const { resumePausedMembershipsJob } = await import("@/lib/jobs/resume-paused-memberships");

    const summary = await resumePausedMembershipsJob.run();

    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    const saved = mockSaveSubscription.mock.calls[0][0];
    expect(saved.status).toBe("active");
    expect(saved.statusBeforePause).toBeNull();
    expect(saved.pausedUntil).toBeNull();
    expect(summary).toMatch(/resumed 1/i);
  });

  it("restores the exact pre-pause status, not just active", async () => {
    mockFindAllSubscriptions.mockReturnValue([pausedSubscription({ statusBeforePause: "past_due" })]);
    const { resumePausedMembershipsJob } = await import("@/lib/jobs/resume-paused-memberships");

    await resumePausedMembershipsJob.run();

    expect(mockSaveSubscription.mock.calls[0][0].status).toBe("past_due");
  });

  it("leaves a still-paused membership alone", async () => {
    mockFindAllSubscriptions.mockReturnValue([
      pausedSubscription({ pausedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() }), // 1h from now
    ]);
    const { resumePausedMembershipsJob } = await import("@/lib/jobs/resume-paused-memberships");

    const summary = await resumePausedMembershipsJob.run();

    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(summary).toMatch(/no paused/i);
  });

  it("ignores non-paused subscriptions entirely", async () => {
    mockFindAllSubscriptions.mockReturnValue([pausedSubscription({ status: "active", pausedUntil: null })]);
    const { resumePausedMembershipsJob } = await import("@/lib/jobs/resume-paused-memberships");

    await resumePausedMembershipsJob.run();

    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });
});
