import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindClassById,
  mockFindBookingsByUserId,
  mockFindBookingsByClassId,
  mockCreateBooking,
  mockFindMembershipPlans,
  mockFindMembershipPlanById,
  mockFindSubscriptionByUserId,
  mockSaveSubscription,
  mockFindWaitlistEntryByClassAndUser,
  mockDeleteWaitlistEntry,
  mockFindWaitlistEntriesByClassId,
  mockSaveWaitlistEntry,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassById: vi.fn(),
  mockFindBookingsByUserId: vi.fn(),
  mockFindBookingsByClassId: vi.fn(),
  mockCreateBooking: vi.fn(),
  mockFindMembershipPlans: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockFindWaitlistEntryByClassAndUser: vi.fn(),
  mockDeleteWaitlistEntry: vi.fn(),
  mockFindWaitlistEntriesByClassId: vi.fn(),
  mockSaveWaitlistEntry: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassById: mockFindClassById,
  findBookingsByUserId: mockFindBookingsByUserId,
  findBookingsByClassId: mockFindBookingsByClassId,
  createBooking: mockCreateBooking,
  findMembershipPlans: mockFindMembershipPlans,
  findMembershipPlanById: mockFindMembershipPlanById,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  saveSubscription: mockSaveSubscription,
  findWaitlistEntryByClassAndUser: mockFindWaitlistEntryByClassAndUser,
  deleteWaitlistEntry: mockDeleteWaitlistEntry,
  findWaitlistEntriesByClassId: mockFindWaitlistEntriesByClassId,
  saveWaitlistEntry: mockSaveWaitlistEntry,
}));

const MEMBER_USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

const SOME_CLASS = {
  id: "class-1",
  title: "Evening Strength",
  category: "strength" as const,
  coachUserId: "staff-1",
  date: "2026-12-25",
  startTime: "18:00",
  durationMins: 60,
  capacity: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ACTIVE_SUBSCRIPTION = {
  userId: MEMBER_USER.id,
  planId: "plan-1",
  status: "active" as const,
  provider: "none" as const,
  providerCustomerId: null,
  providerSubscriptionId: null,
  currentPeriodEnd: null,
  lastWebhookEventAt: null,
  sessionsUsedThisPeriod: 2,
  extraSessionGrants: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const UNLIMITED_PLAN = {
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

async function callBookingsCreate(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/bookings/create/route");
  const request = new NextRequest("http://localhost/api/bookings/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/bookings/create", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindClassById.mockReset();
    mockFindBookingsByUserId.mockReset();
    mockFindBookingsByClassId.mockReset();
    mockCreateBooking.mockReset();
    mockFindMembershipPlans.mockReset();
    mockFindMembershipPlanById.mockReset();
    mockFindSubscriptionByUserId.mockReset();
    mockSaveSubscription.mockReset();
    mockFindWaitlistEntryByClassAndUser.mockReset();
    mockDeleteWaitlistEntry.mockReset();
    mockFindWaitlistEntriesByClassId.mockReset();
    mockSaveWaitlistEntry.mockReset();
    mockFindWaitlistEntriesByClassId.mockReturnValue([]);
    mockFindUserById.mockReturnValue(MEMBER_USER);
    // No plans configured by default, so membership gating doesn't apply —
    // matches the pre-Block-B behavior for all the existing tests below.
    mockFindMembershipPlans.mockReturnValue([]);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockFindWaitlistEntryByClassAndUser.mockReturnValue(undefined);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callBookingsCreate({ classId: "class-1" });

    expect(res.status).toBe(401);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("rejects a missing classId with 400", async () => {
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({}, cookie);

    expect(res.status).toBe(400);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("returns 404 when the class does not exist", async () => {
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "missing-class" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("This class no longer exists.");
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("returns 409 when the class has already started", async () => {
    mockFindClassById.mockReturnValue({
      ...SOME_CLASS,
      date: "2020-01-01",
      startTime: "09:00",
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toBe("This class has already started.");
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("returns 409 when the user has already booked this class", async () => {
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockFindBookingsByUserId.mockReturnValue([
      { id: "booking-1", classId: "class-1", userId: "user-1", createdAt: "now" },
    ]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toBe("You have already booked this class.");
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("returns 409 with a waitlist hint when the class is full", async () => {
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindBookingsByClassId.mockReturnValue([
      { id: "b1", classId: "class-1", userId: "other-1", createdAt: "now" },
      { id: "b2", classId: "class-1", userId: "other-2", createdAt: "now" },
    ]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toMatch(/full.*waitlist/i);
    expect(data.full).toBe(true);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("creates a booking when there is room and the user hasn't booked yet", async () => {
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindBookingsByClassId.mockReturnValue([
      { id: "b1", classId: "class-1", userId: "other-1", createdAt: "now" },
    ]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockCreateBooking).toHaveBeenCalledTimes(1);

    const saved = mockCreateBooking.mock.calls[0][0];
    expect(saved.classId).toBe("class-1");
    expect(saved.userId).toBe(MEMBER_USER.id);
    expect(saved.id).toBeTruthy();
  });

  it("blocks a member without an active subscription once plans exist", async () => {
    mockFindMembershipPlans.mockReturnValue([
      { id: "plan-1", isActive: true, priceCents: 4999, billingInterval: "monthly" },
    ]);
    mockFindSubscriptionByUserId.mockReturnValue({ status: "inactive" });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toMatch(/active membership/i);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("allows a member with an active subscription once plans exist", async () => {
    mockFindMembershipPlans.mockReturnValue([
      { id: "plan-1", isActive: true, priceCents: 4999, billingInterval: "monthly" },
    ]);
    mockFindSubscriptionByUserId.mockReturnValue({ status: "active" });
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindBookingsByClassId.mockReturnValue([]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);

    expect(res.status).toBe(201);
    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
  });

  it("exempts staff from membership gating", async () => {
    mockFindUserById.mockReturnValue({ id: "staff-1", email: "coach@example.com", role: "staff" });
    mockFindMembershipPlans.mockReturnValue([
      { id: "plan-1", isActive: true, priceCents: 4999, billingInterval: "monthly" },
    ]);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindBookingsByClassId.mockReturnValue([]);
    const cookie = signSession({ userId: "staff-1" });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);

    expect(res.status).toBe(201);
    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
  });

  it("blocks booking a class type the member's plan doesn't allow", async () => {
    mockFindMembershipPlans.mockReturnValue([
      { id: "plan-1", isActive: true, priceCents: 4999, billingInterval: "monthly" },
    ]);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockFindMembershipPlanById.mockReturnValue({
      ...UNLIMITED_PLAN,
      allowedCategories: ["mother_and_baby"],
    });
    mockFindClassById.mockReturnValue(SOME_CLASS); // category: "strength"
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindBookingsByClassId.mockReturnValue([]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toMatch(/doesn't include access/i);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("blocks booking once the member has used their full session allowance", async () => {
    mockFindMembershipPlans.mockReturnValue([
      { id: "plan-1", isActive: true, priceCents: 4999, billingInterval: "monthly" },
    ]);
    mockFindSubscriptionByUserId.mockReturnValue({ ...ACTIVE_SUBSCRIPTION, sessionsUsedThisPeriod: 8 });
    mockFindMembershipPlanById.mockReturnValue({ ...UNLIMITED_PLAN, monthlySessionAllowance: 8 });
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindBookingsByClassId.mockReturnValue([]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toMatch(/used all of your sessions/i);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it("allows booking on an unlimited plan regardless of sessions used", async () => {
    mockFindMembershipPlans.mockReturnValue([
      { id: "plan-1", isActive: true, priceCents: 4999, billingInterval: "monthly" },
    ]);
    mockFindSubscriptionByUserId.mockReturnValue({ ...ACTIVE_SUBSCRIPTION, sessionsUsedThisPeriod: 999 });
    mockFindMembershipPlanById.mockReturnValue(UNLIMITED_PLAN);
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindBookingsByClassId.mockReturnValue([]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);

    expect(res.status).toBe(201);
    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
  });

  it("consumes a session and clears a stale waitlist entry on successful booking", async () => {
    mockFindMembershipPlans.mockReturnValue([
      { id: "plan-1", isActive: true, priceCents: 4999, billingInterval: "monthly" },
    ]);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockFindMembershipPlanById.mockReturnValue(UNLIMITED_PLAN);
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindWaitlistEntryByClassAndUser.mockReturnValue({
      id: "wl-1",
      classId: "class-1",
      userId: MEMBER_USER.id,
      createdAt: "now",
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCreate({ classId: "class-1" }, cookie);

    expect(res.status).toBe(201);
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    const savedSub = mockSaveSubscription.mock.calls[0][0];
    expect(savedSub.sessionsUsedThisPeriod).toBe(ACTIVE_SUBSCRIPTION.sessionsUsedThisPeriod + 1);
    // Stale entries are soft-removed (offerState "removed"), not deleted.
    expect(mockSaveWaitlistEntry).toHaveBeenCalledTimes(1);
    expect(mockSaveWaitlistEntry.mock.calls[0][0]).toMatchObject({ id: "wl-1", offerState: "removed" });
  });
});
