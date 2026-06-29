import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindBookingsByClassId,
  mockFindClasses,
  mockFindMembers,
  mockFindMembershipPlanById,
  mockFindMessagesByMemberId,
  mockFindProfileByUserId,
  mockFindRecoveryLogsByUserId,
  mockFindSubscriptionByUserId,
  mockFindWaitlistEntriesByClassId,
} = vi.hoisted(() => ({
  mockFindBookingsByClassId: vi.fn(),
  mockFindClasses: vi.fn(),
  mockFindMembers: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
  mockFindMessagesByMemberId: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
  mockFindRecoveryLogsByUserId: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindWaitlistEntriesByClassId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findBookingsByClassId: mockFindBookingsByClassId,
  findClasses: mockFindClasses,
  findMembers: mockFindMembers,
  findMembershipPlanById: mockFindMembershipPlanById,
  findMessagesByMemberId: mockFindMessagesByMemberId,
  findProfileByUserId: mockFindProfileByUserId,
  findRecoveryLogsByUserId: mockFindRecoveryLogsByUserId,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findWaitlistEntriesByClassId: mockFindWaitlistEntriesByClassId,
}));

const MEMBER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

const PLAN = {
  id: "plan-1",
  name: "Premium",
  description: null,
  priceCents: 4999,
  billingInterval: "monthly" as const,
  monthlySessionAllowance: 8,
  allowedCategories: [],
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function activeSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: MEMBER.id,
    planId: PLAN.id,
    status: "active" as const,
    provider: "none" as const,
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 0,
    periodLapsedNotifiedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildMemberOperationalSummaries", () => {
  beforeEach(() => {
    mockFindMembers.mockReset();
    mockFindMembershipPlanById.mockReset();
    mockFindMessagesByMemberId.mockReset();
    mockFindProfileByUserId.mockReset();
    mockFindRecoveryLogsByUserId.mockReset();
    mockFindSubscriptionByUserId.mockReset();

    mockFindMembers.mockReturnValue([MEMBER]);
    mockFindProfileByUserId.mockReturnValue({ fullName: "Alex Athlete" });
    mockFindMembershipPlanById.mockReturnValue(PLAN);
    mockFindRecoveryLogsByUserId.mockReturnValue([]);
    mockFindMessagesByMemberId.mockReturnValue([]);
  });

  it("flags no attention reasons for a healthy active member", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSubscription({ sessionsUsedThisPeriod: 2 }));
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.attentionReasons).toEqual([]);
    expect(summary.remainingSessions).toBe(6);
  });

  it("flags past_due", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSubscription({ status: "past_due" }));
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.attentionReasons).toContain("Past due");
  });

  it("flags a lapsed period", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(
      activeSubscription({ currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
    );
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.attentionReasons).toContain("Period lapsed");
  });

  it("flags no active plan when there's no subscription at all", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.attentionReasons).toContain("No active plan");
    expect(summary.planName).toBeNull();
  });

  it("flags no sessions remaining when the allowance is used up", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSubscription({ sessionsUsedThisPeriod: 8 }));
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.attentionReasons).toContain("No sessions remaining");
    expect(summary.remainingSessions).toBe(0);
  });

  it("does not flag no-sessions for an unlimited plan", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSubscription({ sessionsUsedThisPeriod: 500 }));
    mockFindMembershipPlanById.mockReturnValue({ ...PLAN, monthlySessionAllowance: null });
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.attentionReasons).not.toContain("No sessions remaining");
    expect(summary.remainingSessions).toBeNull();
  });

  it("flags awaiting reply when the member sent the last message", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSubscription());
    mockFindMessagesByMemberId.mockReturnValue([
      { id: "m1", memberId: MEMBER.id, senderId: MEMBER.id, senderRole: "member", body: "Hi", createdAt: "now" },
    ]);
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.awaitingReply).toBe(true);
    expect(summary.attentionReasons).toContain("Awaiting reply");
  });

  it("does not flag awaiting reply when staff sent the last message", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSubscription());
    mockFindMessagesByMemberId.mockReturnValue([
      { id: "m1", memberId: MEMBER.id, senderId: "staff-1", senderRole: "staff", body: "Hi", createdAt: "now" },
    ]);
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.awaitingReply).toBe(false);
    expect(summary.attentionReasons).not.toContain("Awaiting reply");
  });

  it("surfaces the latest readiness score", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(activeSubscription());
    mockFindRecoveryLogsByUserId.mockReturnValue([{ readinessScore: 72 }, { readinessScore: 50 }]);
    const { buildMemberOperationalSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildMemberOperationalSummaries();

    expect(summary.latestReadinessScore).toBe(72);
  });
});

describe("buildUpcomingClassPressureSummaries", () => {
  beforeEach(() => {
    mockFindClasses.mockReset();
    mockFindBookingsByClassId.mockReset();
    mockFindWaitlistEntriesByClassId.mockReset();
  });

  it("excludes classes that have already started", async () => {
    mockFindClasses.mockReturnValue([
      { id: "past", title: "Past", category: "general", date: "2020-01-01", startTime: "09:00", capacity: 10, coachUserId: "s1", createdAt: "x", updatedAt: "x" },
    ]);
    const { buildUpcomingClassPressureSummaries } = await import("@/lib/staff-operations");

    expect(buildUpcomingClassPressureSummaries()).toEqual([]);
  });

  it("reports booked count, waitlist count, and full status for an upcoming class", async () => {
    mockFindClasses.mockReturnValue([
      { id: "class-1", title: "Strength", category: "strength", date: "2026-12-25", startTime: "09:00", capacity: 1, coachUserId: "s1", createdAt: "x", updatedAt: "x" },
    ]);
    mockFindBookingsByClassId.mockReturnValue([{ id: "b1" }]);
    mockFindWaitlistEntriesByClassId.mockReturnValue([{ id: "w1" }, { id: "w2" }]);
    const { buildUpcomingClassPressureSummaries } = await import("@/lib/staff-operations");

    const [summary] = buildUpcomingClassPressureSummaries();

    expect(summary.bookedCount).toBe(1);
    expect(summary.waitlistCount).toBe(2);
    expect(summary.isFull).toBe(true);
  });
});
