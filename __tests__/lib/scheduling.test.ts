import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindClassById,
  mockFindBookingsByClassId,
  mockFindBookingsByUserId,
  mockFindWaitlistEntriesByClassId,
  mockFindUserById,
  mockFindSubscriptionByUserId,
  mockFindMembershipPlanById,
  mockCreateBooking,
  mockSaveSubscription,
  mockDeleteWaitlistEntry,
  mockCreateMessage,
  mockHasActiveMembership,
} = vi.hoisted(() => ({
  mockFindClassById: vi.fn(),
  mockFindBookingsByClassId: vi.fn(),
  mockFindBookingsByUserId: vi.fn(),
  mockFindWaitlistEntriesByClassId: vi.fn(),
  mockFindUserById: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
  mockCreateBooking: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockDeleteWaitlistEntry: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockHasActiveMembership: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findClassById: mockFindClassById,
  findBookingsByClassId: mockFindBookingsByClassId,
  findBookingsByUserId: mockFindBookingsByUserId,
  findWaitlistEntriesByClassId: mockFindWaitlistEntriesByClassId,
  findUserById: mockFindUserById,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findMembershipPlanById: mockFindMembershipPlanById,
  createBooking: mockCreateBooking,
  saveSubscription: mockSaveSubscription,
  deleteWaitlistEntry: mockDeleteWaitlistEntry,
  createMessage: mockCreateMessage,
}));

vi.mock("@/lib/membership", () => ({
  hasActiveMembership: mockHasActiveMembership,
}));

const CLASS = {
  id: "class-1",
  title: "Evening Strength",
  category: "strength" as const,
  coachUserId: "staff-1",
  date: "2026-12-25",
  startTime: "18:00",
  durationMins: 60,
  capacity: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const PLAN = {
  id: "plan-1",
  name: "Premium",
  description: null,
  priceCents: 4999,
  billingInterval: "monthly" as const,
  monthlySessionAllowance: null,
  allowedCategories: ["general", "strength", "cardio"] as const,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ACTIVE_SUBSCRIPTION = {
  userId: "member-1",
  planId: "plan-1",
  status: "active" as const,
  provider: "none" as const,
  providerCustomerId: null,
  providerSubscriptionId: null,
  currentPeriodEnd: null,
  lastWebhookEventAt: null,
  sessionsUsedThisPeriod: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function waitlistEntry(userId: string, minutesAgo: number) {
  return {
    id: `wl-${userId}`,
    classId: "class-1",
    userId,
    createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  };
}

describe("getCancellationCutoffHours / isCancellationEarly", () => {
  const originalEnv = process.env.CANCELLATION_CUTOFF_HOURS;

  afterEach(() => {
    process.env.CANCELLATION_CUTOFF_HOURS = originalEnv;
  });

  it("defaults to 12 hours when unset", async () => {
    delete process.env.CANCELLATION_CUTOFF_HOURS;
    const { getCancellationCutoffHours } = await import("@/lib/scheduling");
    expect(getCancellationCutoffHours()).toBe(12);
  });

  it("uses a configured value", async () => {
    process.env.CANCELLATION_CUTOFF_HOURS = "6";
    const { getCancellationCutoffHours } = await import("@/lib/scheduling");
    expect(getCancellationCutoffHours()).toBe(6);
  });

  it("falls back to the default for an invalid value", async () => {
    process.env.CANCELLATION_CUTOFF_HOURS = "not-a-number";
    const { getCancellationCutoffHours } = await import("@/lib/scheduling");
    expect(getCancellationCutoffHours()).toBe(12);
  });

  it("treats a class well outside the cutoff as early", async () => {
    delete process.env.CANCELLATION_CUTOFF_HOURS;
    const { isCancellationEarly } = await import("@/lib/scheduling");
    const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(isCancellationEarly(farFuture)).toBe(true);
  });

  it("treats a class within the cutoff as late", async () => {
    delete process.env.CANCELLATION_CUTOFF_HOURS;
    const { isCancellationEarly } = await import("@/lib/scheduling");
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect(isCancellationEarly(soon)).toBe(false);
  });
});

describe("promoteFromWaitlist", () => {
  beforeEach(() => {
    mockFindClassById.mockReset();
    mockFindBookingsByClassId.mockReset();
    mockFindBookingsByUserId.mockReset();
    mockFindWaitlistEntriesByClassId.mockReset();
    mockFindUserById.mockReset();
    mockFindSubscriptionByUserId.mockReset();
    mockFindMembershipPlanById.mockReset();
    mockCreateBooking.mockReset();
    mockSaveSubscription.mockReset();
    mockDeleteWaitlistEntry.mockReset();
    mockCreateMessage.mockReset();
    mockHasActiveMembership.mockReset();

    mockFindClassById.mockReturnValue(CLASS);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindUserById.mockImplementation((id: string) => ({ id, email: `${id}@example.com`, role: "member" }));
    mockFindMembershipPlanById.mockReturnValue(PLAN);
  });

  it("does nothing when the class doesn't exist", async () => {
    mockFindClassById.mockReturnValue(undefined);
    const { promoteFromWaitlist } = await import("@/lib/scheduling");

    promoteFromWaitlist("class-1");

    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("does nothing when there's no actual open spot", async () => {
    mockFindBookingsByClassId.mockReturnValue([{ id: "b1", classId: "class-1", userId: "someone", attendedAt: null, createdAt: "now" }]);
    const { promoteFromWaitlist } = await import("@/lib/scheduling");

    promoteFromWaitlist("class-1");

    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("promotes the first eligible waitlisted member, consuming a session", async () => {
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindWaitlistEntriesByClassId.mockReturnValue([waitlistEntry("member-1", 5)]);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockHasActiveMembership.mockReturnValue(true);

    const { promoteFromWaitlist } = await import("@/lib/scheduling");
    promoteFromWaitlist("class-1");

    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
    expect(mockCreateBooking.mock.calls[0][0].userId).toBe("member-1");
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    expect(mockSaveSubscription.mock.calls[0][0].sessionsUsedThisPeriod).toBe(1);
    expect(mockDeleteWaitlistEntry).toHaveBeenCalledWith("wl-member-1");
    expect(mockCreateMessage).toHaveBeenCalledTimes(1);
  });

  it("skips a waitlisted member without an active membership", async () => {
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      waitlistEntry("inactive-member", 10),
      waitlistEntry("member-1", 5),
    ]);
    mockHasActiveMembership.mockImplementation((id: string) => id === "member-1");
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);

    const { promoteFromWaitlist } = await import("@/lib/scheduling");
    promoteFromWaitlist("class-1");

    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
    expect(mockCreateBooking.mock.calls[0][0].userId).toBe("member-1");
  });

  it("skips a waitlisted member whose plan doesn't cover this class category", async () => {
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      waitlistEntry("mother-baby-member", 10),
      waitlistEntry("member-1", 5),
    ]);
    mockHasActiveMembership.mockReturnValue(true);
    mockFindSubscriptionByUserId.mockImplementation((id: string) =>
      id === "mother-baby-member" ? { ...ACTIVE_SUBSCRIPTION, planId: "plan-mb" } : ACTIVE_SUBSCRIPTION
    );
    mockFindMembershipPlanById.mockImplementation((id: string) =>
      id === "plan-mb" ? { ...PLAN, id: "plan-mb", allowedCategories: ["mother_and_baby"] } : PLAN
    );

    const { promoteFromWaitlist } = await import("@/lib/scheduling");
    promoteFromWaitlist("class-1");

    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
    expect(mockCreateBooking.mock.calls[0][0].userId).toBe("member-1");
  });

  it("skips a waitlisted member with no remaining sessions", async () => {
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      waitlistEntry("out-of-sessions", 10),
      waitlistEntry("member-1", 5),
    ]);
    mockHasActiveMembership.mockReturnValue(true);
    mockFindSubscriptionByUserId.mockImplementation((id: string) =>
      id === "out-of-sessions" ? { ...ACTIVE_SUBSCRIPTION, sessionsUsedThisPeriod: 8 } : ACTIVE_SUBSCRIPTION
    );
    mockFindMembershipPlanById.mockImplementation(() => ({ ...PLAN, monthlySessionAllowance: 8 }));

    const { promoteFromWaitlist } = await import("@/lib/scheduling");
    promoteFromWaitlist("class-1");

    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
    expect(mockCreateBooking.mock.calls[0][0].userId).toBe("member-1");
  });

  it("promotes at most one person even with multiple eligible waitlisted members", async () => {
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      waitlistEntry("member-1", 10),
      waitlistEntry("member-2", 5),
    ]);
    mockHasActiveMembership.mockReturnValue(true);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);

    const { promoteFromWaitlist } = await import("@/lib/scheduling");
    promoteFromWaitlist("class-1");

    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
  });
});
