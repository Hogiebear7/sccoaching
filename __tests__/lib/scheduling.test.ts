import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classStartMs, currentHourInGymTimeZone, gymLocalDateString } from "@/lib/class-time";

const {
  mockFindClassById,
  mockFindBookingsByClassId,
  mockFindBookingsByUserId,
  mockFindWaitlistEntriesByClassId,
  mockFindUserById,
  mockFindSubscriptionByUserId,
  mockResolveEntitlement,
  mockSaveWaitlistEntry,
  mockCreateNotification,
  mockHasActiveMembership,
} = vi.hoisted(() => ({
  mockFindClassById: vi.fn(),
  mockFindBookingsByClassId: vi.fn(),
  mockFindBookingsByUserId: vi.fn(),
  mockFindWaitlistEntriesByClassId: vi.fn(),
  mockFindUserById: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockResolveEntitlement: vi.fn(),
  mockSaveWaitlistEntry: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockHasActiveMembership: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  // Pass-pack coverage in offer eligibility: default = no purchased passes
  findPassLedgerByUserId: vi.fn(() => []),
  findPassLedgerByBookingId: vi.fn(() => []),
  findPassLedgerByPurchaseId: vi.fn(() => []),
  appendPassLedgerEntry: vi.fn(),
  savePurchase: vi.fn(),
  findClassById: mockFindClassById,
  findBookingsByClassId: mockFindBookingsByClassId,
  findBookingsByUserId: mockFindBookingsByUserId,
  findWaitlistEntriesByClassId: mockFindWaitlistEntriesByClassId,
  findUserById: mockFindUserById,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  saveWaitlistEntry: mockSaveWaitlistEntry,
  createNotification: mockCreateNotification,
}));

vi.mock("@/lib/membership-entitlement", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/membership-entitlement")>()),
  resolveSubscriptionEntitlement: mockResolveEntitlement,
}));

vi.mock("@/lib/membership", () => ({
  hasActiveMembership: mockHasActiveMembership,
}));

// Class whose start time is well in the future (Christmas 2026).
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
  providerSetupOrderId: null,
  currentPeriodEnd: null,
  lastWebhookEventAt: null,
  sessionsUsedThisPeriod: 0,
  extraSessionGrants: [],
  periodLapsedNotifiedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function waitlistEntry(userId: string, minutesAgo: number) {
  return {
    id: `wl-${userId}`,
    classId: "class-1",
    userId,
    offerState: "queued" as const,
    offerExpiresAt: null,
    warningNotifiedAt: null,
    resolvedAt: null,
    createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  };
}

describe("getCancellationCutoffHours / isCancellationEarly", () => {
  const originalEnv = process.env.CANCELLATION_CUTOFF_HOURS;

  afterEach(() => {
    process.env.CANCELLATION_CUTOFF_HOURS = originalEnv;
  });

  it("defaults to 3 hours when unset", async () => {
    delete process.env.CANCELLATION_CUTOFF_HOURS;
    const { getCancellationCutoffHours } = await import("@/lib/scheduling");
    expect(getCancellationCutoffHours()).toBe(3);
  });

  it("uses a configured value", async () => {
    process.env.CANCELLATION_CUTOFF_HOURS = "6";
    const { getCancellationCutoffHours } = await import("@/lib/scheduling");
    expect(getCancellationCutoffHours()).toBe(6);
  });

  it("falls back to the default for an invalid value", async () => {
    process.env.CANCELLATION_CUTOFF_HOURS = "not-a-number";
    const { getCancellationCutoffHours } = await import("@/lib/scheduling");
    expect(getCancellationCutoffHours()).toBe(3);
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

describe("computeOfferWindowMs", () => {
  // Pinned to a daytime hour (outside the 8pm-10am quiet-hours extension)
  // so these cases exercise the plain proximity tiers deterministically,
  // regardless of what time the test suite actually runs.
  // Dublin-local, not server-local — the point of this whole test file is
  // Dublin-time correctness, so "9pm" should mean 9pm Dublin regardless of
  // what timezone the test runner itself happens to be in.
  function atHour(hour: number): number {
    const hh = String(hour).padStart(2, "0");
    return classStartMs(gymLocalDateString(new Date()), `${hh}:00`);
  }

  it("returns 3 hours when class is between 90 min and 2 days away", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(14);
    const classMs = now + 4 * 60 * 60 * 1000;
    expect(computeOfferWindowMs(classMs, now)).toBe(3 * 60 * 60 * 1000);
  });

  it("returns 90 minutes when class is between 90 min and 3 hours away", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(14);
    const classMs = now + 2 * 60 * 60 * 1000;
    expect(computeOfferWindowMs(classMs, now)).toBe(90 * 60 * 1000);
  });

  it("returns 30 minutes when class is less than 90 minutes away", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(14);
    const classMs = now + 45 * 60 * 1000;
    expect(computeOfferWindowMs(classMs, now)).toBe(30 * 60 * 1000);
  });

  it("returns 12 hours when class is more than 2 days away", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(14);
    const classMs = now + 3 * 24 * 60 * 60 * 1000;
    expect(computeOfferWindowMs(classMs, now)).toBe(12 * 60 * 60 * 1000);
  });

  it("extends the window to 10am the next morning when issued at night", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(21); // 9pm
    const classMs = now + 24 * 60 * 60 * 1000; // 1 day away — base window would be 3hr
    const windowMs = computeOfferWindowMs(classMs, now);
    const expiresAt = new Date(now + windowMs);
    expect(currentHourInGymTimeZone(expiresAt)).toBe(10);
    expect(gymLocalDateString(expiresAt)).toBe(gymLocalDateString(new Date(now + 24 * 60 * 60 * 1000)));
  });

  it("extends the window to 10am the same morning when issued just after midnight", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(1); // 1am
    const classMs = now + 24 * 60 * 60 * 1000; // 1 day away — base window would be 3hr
    const windowMs = computeOfferWindowMs(classMs, now);
    const expiresAt = new Date(now + windowMs);
    expect(currentHourInGymTimeZone(expiresAt)).toBe(10);
    expect(gymLocalDateString(expiresAt)).toBe(gymLocalDateString(new Date(now)));
  });

  it("a far-out class offered at night is extended at least to the 12hr floor (may land after 10am)", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(1); // 1am — quiet-hours target (10am) is only 9hr away, less than the 12hr floor
    const classMs = now + 3 * 24 * 60 * 60 * 1000;
    expect(computeOfferWindowMs(classMs, now)).toBe(12 * 60 * 60 * 1000);
  });

  it("does not extend into quiet hours for the imminent (<90 min) tier", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(23); // 11pm
    const classMs = now + 45 * 60 * 1000;
    expect(computeOfferWindowMs(classMs, now)).toBe(30 * 60 * 1000);
  });

  it("caps the quiet-hours extension at the time actually remaining until class", async () => {
    const { computeOfferWindowMs } = await import("@/lib/scheduling");
    const now = atHour(21); // 9pm — quiet hours, extension target is ~13hr away
    const classMs = now + 5 * 60 * 60 * 1000; // class in 5hr, before that extension target
    expect(computeOfferWindowMs(classMs, now)).toBe(5 * 60 * 60 * 1000);
  });
});

describe("issueWaitlistOffer", () => {
  beforeEach(() => {
    mockFindClassById.mockReset();
    mockFindBookingsByClassId.mockReset();
    mockFindBookingsByUserId.mockReset();
    mockFindWaitlistEntriesByClassId.mockReset();
    mockFindUserById.mockReset();
    mockFindSubscriptionByUserId.mockReset();
    mockResolveEntitlement.mockReset();
    mockSaveWaitlistEntry.mockReset();
    mockCreateNotification.mockReset();
    mockHasActiveMembership.mockReset();

    mockFindClassById.mockReturnValue(CLASS);
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindWaitlistEntriesByClassId.mockReturnValue([]);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindUserById.mockImplementation((id: string) => ({ id, email: `${id}@example.com`, role: "member" }));
    mockResolveEntitlement.mockReturnValue(PLAN);
  });

  it("does nothing when the class doesn't exist", async () => {
    mockFindClassById.mockReturnValue(undefined);
    const { issueWaitlistOffer } = await import("@/lib/scheduling");

    issueWaitlistOffer("class-1");

    expect(mockSaveWaitlistEntry).not.toHaveBeenCalled();
  });

  it("does nothing when effectively full (bookings + open offers >= capacity)", async () => {
    mockFindBookingsByClassId.mockReturnValue([
      { id: "b1", classId: "class-1", userId: "someone", attendedAt: null, createdAt: "now" },
    ]);
    // capacity is 1, 1 booking → effectively full even with no offered slots
    mockFindWaitlistEntriesByClassId.mockReturnValue([waitlistEntry("member-1", 5)]);
    const { issueWaitlistOffer } = await import("@/lib/scheduling");

    issueWaitlistOffer("class-1");

    expect(mockSaveWaitlistEntry).not.toHaveBeenCalled();
  });

  it("does nothing when a slot is already held by an open offer", async () => {
    mockFindBookingsByClassId.mockReturnValue([]); // no confirmed bookings
    // One offered slot — capacity 1 is fully held
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      { ...waitlistEntry("member-1", 5), offerState: "offered" as const, offerExpiresAt: new Date(Date.now() + 3600_000).toISOString() },
    ]);
    const { issueWaitlistOffer } = await import("@/lib/scheduling");

    issueWaitlistOffer("class-1");

    expect(mockSaveWaitlistEntry).not.toHaveBeenCalled();
  });

  it("issues an offer to the first eligible queued member", async () => {
    mockFindWaitlistEntriesByClassId.mockReturnValue([waitlistEntry("member-1", 5)]);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockHasActiveMembership.mockReturnValue(true);

    const { issueWaitlistOffer } = await import("@/lib/scheduling");
    issueWaitlistOffer("class-1");

    expect(mockSaveWaitlistEntry).toHaveBeenCalledTimes(1);
    const saved = mockSaveWaitlistEntry.mock.calls[0][0];
    expect(saved.userId).toBe("member-1");
    expect(saved.offerState).toBe("offered");
    expect(saved.offerExpiresAt).not.toBeNull();
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const notif = mockCreateNotification.mock.calls[0][0];
    expect(notif.type).toBe("waitlist_offer");
    expect(notif.userId).toBe("member-1");
  });

  it("skips a queued member without an active membership", async () => {
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      waitlistEntry("inactive-member", 10),
      waitlistEntry("member-1", 5),
    ]);
    mockHasActiveMembership.mockImplementation((id: string) => id === "member-1");
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);

    const { issueWaitlistOffer } = await import("@/lib/scheduling");
    issueWaitlistOffer("class-1");

    expect(mockSaveWaitlistEntry).toHaveBeenCalledTimes(1);
    expect(mockSaveWaitlistEntry.mock.calls[0][0].userId).toBe("member-1");
    expect(mockSaveWaitlistEntry.mock.calls[0][0].offerState).toBe("offered");
  });

  it("skips a queued member whose plan doesn't cover this class category", async () => {
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      waitlistEntry("restricted-member", 10),
      waitlistEntry("member-1", 5),
    ]);
    mockHasActiveMembership.mockReturnValue(true);
    mockFindSubscriptionByUserId.mockImplementation((id: string) =>
      id === "restricted-member"
        ? { ...ACTIVE_SUBSCRIPTION, planId: "plan-mb" }
        : ACTIVE_SUBSCRIPTION
    );
    mockResolveEntitlement.mockImplementation((sub: { planId?: string } | undefined) =>
      sub?.planId === "plan-mb"
        ? { ...PLAN, id: "plan-mb", allowedCategories: ["mother_and_baby"] }
        : PLAN
    );

    const { issueWaitlistOffer } = await import("@/lib/scheduling");
    issueWaitlistOffer("class-1");

    expect(mockSaveWaitlistEntry).toHaveBeenCalledTimes(1);
    expect(mockSaveWaitlistEntry.mock.calls[0][0].userId).toBe("member-1");
    expect(mockSaveWaitlistEntry.mock.calls[0][0].offerState).toBe("offered");
  });

  it("skips a queued member with no remaining sessions", async () => {
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      waitlistEntry("out-of-sessions", 10),
      waitlistEntry("member-1", 5),
    ]);
    mockHasActiveMembership.mockReturnValue(true);
    mockFindSubscriptionByUserId.mockImplementation((id: string) =>
      id === "out-of-sessions"
        ? { ...ACTIVE_SUBSCRIPTION, sessionsUsedThisPeriod: 8 }
        : ACTIVE_SUBSCRIPTION
    );
    mockResolveEntitlement.mockImplementation(() => ({ ...PLAN, monthlySessionAllowance: 8 }));

    const { issueWaitlistOffer } = await import("@/lib/scheduling");
    issueWaitlistOffer("class-1");

    expect(mockSaveWaitlistEntry).toHaveBeenCalledTimes(1);
    expect(mockSaveWaitlistEntry.mock.calls[0][0].userId).toBe("member-1");
    expect(mockSaveWaitlistEntry.mock.calls[0][0].offerState).toBe("offered");
  });

  it("issues at most one offer per call even with multiple eligible queued members", async () => {
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      waitlistEntry("member-1", 10),
      waitlistEntry("member-2", 5),
    ]);
    mockHasActiveMembership.mockReturnValue(true);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);

    const { issueWaitlistOffer } = await import("@/lib/scheduling");
    // Capacity is 1, no bookings, so exactly one offer should be issued.
    issueWaitlistOffer("class-1");

    const offeredSaves = mockSaveWaitlistEntry.mock.calls.filter(
      (c) => c[0].offerState === "offered"
    );
    expect(offeredSaves).toHaveLength(1);
  });
});
