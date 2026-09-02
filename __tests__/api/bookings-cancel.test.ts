import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindBookingById,
  mockFindClassById,
  mockDeleteBooking,
  mockFindSubscriptionByUserId,
  mockSaveSubscription,
  mockIssueWaitlistOffer,
  mockIsCancellationEarly,
  mockAppendPassLedgerEntry,
  mockFindPassLedgerByBookingId,
  mockCreatePendingCancellationCredit,
  mockFindWeeklyTrainingScheduleByUserId,
  mockSaveWeeklyTrainingSchedule,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindBookingById: vi.fn(),
  mockFindClassById: vi.fn(),
  mockDeleteBooking: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockIssueWaitlistOffer: vi.fn(),
  mockIsCancellationEarly: vi.fn(),
  mockAppendPassLedgerEntry: vi.fn(),
  mockFindPassLedgerByBookingId: vi.fn(),
  mockCreatePendingCancellationCredit: vi.fn(),
  mockFindWeeklyTrainingScheduleByUserId: vi.fn(),
  mockSaveWeeklyTrainingSchedule: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  // Booking-cancellation email helper reads the member profile; undefined here
  // makes the fire-and-forget email a no-op (these tests assert cancel logic).
  findProfileByUserId: vi.fn(),
  isTransactionalEmailEnabled: vi.fn(() => true),
  findBookingById: mockFindBookingById,
  findClassById: mockFindClassById,
  deleteBooking: mockDeleteBooking,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  saveSubscription: mockSaveSubscription,
  appendPassLedgerEntry: mockAppendPassLedgerEntry,
  findPassLedgerByBookingId: mockFindPassLedgerByBookingId,
  findPassLedgerByUserId: vi.fn(() => []),
  findPassLedgerByPurchaseId: vi.fn(() => []),
  findClassPassProductById: vi.fn(),
  savePurchase: vi.fn(),
  // Late-cancellation credit tracking (lib/cancellation-credits.ts) — these
  // tests only exercise the "forfeit" side, never the refill/resolve side.
  createPendingCancellationCredit: mockCreatePendingCancellationCredit,
  createNotification: vi.fn(),
  findWeeklyTrainingScheduleByUserId: mockFindWeeklyTrainingScheduleByUserId,
  saveWeeklyTrainingSchedule: mockSaveWeeklyTrainingSchedule,
}));

vi.mock("@/lib/scheduling", () => ({
  issueWaitlistOffer: mockIssueWaitlistOffer,
  isCancellationEarly: mockIsCancellationEarly,
}));

// Cancellation is now push-only (no email) — stub the send so these tests
// keep asserting cancel logic, not the notification pipeline.
vi.mock("@/lib/push", () => ({ sendPush: vi.fn() }));

const MEMBER_USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };
const OTHER_USER = { id: "user-2", email: "other@example.com", role: "member" as const };

const SOME_BOOKING = {
  id: "booking-1",
  classId: "class-1",
  userId: "user-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const FUTURE_CLASS = {
  id: "class-1",
  title: "Evening Strength",
  category: "strength" as const,
  coachUserId: "staff-1",
  date: "2026-12-25",
  startTime: "18:00",
  durationMins: 60,
  capacity: 10,
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
  sessionsUsedThisPeriod: 3,
  extraSessionGrants: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callBookingsCancel(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/bookings/cancel/route");
  const request = new NextRequest("http://localhost/api/bookings/cancel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/bookings/cancel", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindBookingById.mockReset();
    mockFindClassById.mockReset();
    mockDeleteBooking.mockReset();
    mockFindSubscriptionByUserId.mockReset();
    mockSaveSubscription.mockReset();
    mockIssueWaitlistOffer.mockReset();
    mockIsCancellationEarly.mockReset();
    mockAppendPassLedgerEntry.mockReset();
    mockFindPassLedgerByBookingId.mockReset();
    mockFindPassLedgerByBookingId.mockReturnValue([]);
    mockCreatePendingCancellationCredit.mockReset();
    mockFindWeeklyTrainingScheduleByUserId.mockReset();
    mockSaveWeeklyTrainingSchedule.mockReset();
    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockIsCancellationEarly.mockReturnValue(true);
    mockFindWeeklyTrainingScheduleByUserId.mockReturnValue(undefined);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callBookingsCancel({ bookingId: "booking-1" });

    expect(res.status).toBe(401);
    expect(mockDeleteBooking).not.toHaveBeenCalled();
  });

  it("rejects a missing bookingId with 400", async () => {
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({}, cookie);

    expect(res.status).toBe(400);
    expect(mockDeleteBooking).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking does not exist", async () => {
    mockFindBookingById.mockReturnValue(undefined);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({ bookingId: "missing-booking" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("This booking no longer exists.");
    expect(mockDeleteBooking).not.toHaveBeenCalled();
  });

  it("returns 403 when cancelling another user's booking", async () => {
    mockFindUserById.mockReturnValue(OTHER_USER);
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    const cookie = signSession({ userId: OTHER_USER.id });

    const res = await callBookingsCancel({ bookingId: "booking-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toBe("You can only cancel your own bookings.");
    expect(mockDeleteBooking).not.toHaveBeenCalled();
  });

  it("returns 409 when the class has already started", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue({ ...FUTURE_CLASS, date: "2020-01-01", startTime: "09:00" });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({ bookingId: "booking-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toBe(
      "This class has already started and can no longer be cancelled."
    );
    expect(mockDeleteBooking).not.toHaveBeenCalled();
  });

  it("restores the session and reports it when cancelling before the cutoff", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockIsCancellationEarly.mockReturnValue(true);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({ bookingId: "booking-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.sessionRestored).toBe(true);
    expect(data.message).toMatch(/restored/i);
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    expect(mockSaveSubscription.mock.calls[0][0].sessionsUsedThisPeriod).toBe(2);
    expect(mockDeleteBooking).toHaveBeenCalledWith("booking-1");
    expect(mockIssueWaitlistOffer).toHaveBeenCalledWith("class-1");
  });

  it("removes the Weekly Training entry this booking synced, leaving unrelated sessions alone", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockIsCancellationEarly.mockReturnValue(true);
    mockFindWeeklyTrainingScheduleByUserId.mockReturnValue({
      userId: MEMBER_USER.id,
      updatedAt: "2026-01-01T00:00:00.000Z",
      sessions: [
        {
          id: "wt-synced",
          dayOfWeek: 5,
          label: "Evening Strength",
          activityType: "gym",
          timeOfDay: "evening",
          intensity: "moderate",
          estimatedDurationMins: 60,
          notes: null,
          recurring: false,
          weekOf: "2026-12-21",
          sourceBookingId: "booking-1", // this booking's synced entry
        },
        {
          id: "wt-manual",
          dayOfWeek: 2,
          label: "Football training",
          activityType: "sport",
          timeOfDay: "evening",
          intensity: "heavy",
          estimatedDurationMins: 90,
          notes: null,
          recurring: true,
          weekOf: null,
          sourceBookingId: null, // member-created, unrelated to this booking
        },
      ],
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    await callBookingsCancel({ bookingId: "booking-1" }, cookie);

    expect(mockSaveWeeklyTrainingSchedule).toHaveBeenCalledTimes(1);
    const saved = mockSaveWeeklyTrainingSchedule.mock.calls[0][0];
    expect(saved.userId).toBe(MEMBER_USER.id);
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].id).toBe("wt-manual");
  });

  it("skips the Weekly Training save when nothing was synced for this booking", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockIsCancellationEarly.mockReturnValue(true);
    mockFindWeeklyTrainingScheduleByUserId.mockReturnValue({
      userId: MEMBER_USER.id,
      updatedAt: "2026-01-01T00:00:00.000Z",
      sessions: [
        {
          id: "wt-manual",
          dayOfWeek: 2,
          label: "Football training",
          activityType: "sport",
          timeOfDay: "evening",
          intensity: "heavy",
          estimatedDurationMins: 90,
          notes: null,
          recurring: true,
          weekOf: null,
          sourceBookingId: null,
        },
      ],
    });
    const cookie = signSession({ userId: MEMBER_USER.id });

    await callBookingsCancel({ bookingId: "booking-1" }, cookie);

    expect(mockSaveWeeklyTrainingSchedule).not.toHaveBeenCalled();
  });

  it("returns a purchased pass on early cancel instead of touching the counter", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockIsCancellationEarly.mockReturnValue(true);
    // This booking consumed a purchased pass
    mockFindPassLedgerByBookingId.mockReturnValue([
      { id: "led-1", userId: MEMBER_USER.id, delta: -1, reason: "consume", purchaseId: null, bookingId: "booking-1", note: null, createdAt: "x" },
    ]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({ bookingId: "booking-1" }, cookie);

    expect(res.status).toBe(200);
    expect(mockAppendPassLedgerEntry).toHaveBeenCalledTimes(1);
    expect(mockAppendPassLedgerEntry.mock.calls[0][0]).toMatchObject({
      delta: 1,
      reason: "consume_reversal",
      bookingId: "booking-1",
    });
    // The plan counter is left alone — the pass pool is what gets refunded
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("late cancellation keeps a consumed pass consumed", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockIsCancellationEarly.mockReturnValue(false);
    mockFindPassLedgerByBookingId.mockReturnValue([
      { id: "led-1", userId: MEMBER_USER.id, delta: -1, reason: "consume", purchaseId: null, bookingId: "booking-1", note: null, createdAt: "x" },
    ]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({ bookingId: "booking-1" }, cookie);

    expect(res.status).toBe(200);
    expect(mockAppendPassLedgerEntry).not.toHaveBeenCalled();
    expect(mockSaveSubscription).not.toHaveBeenCalled();
  });

  it("does not restore the session when cancelling inside the cutoff, but tracks it as reversible", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockFindSubscriptionByUserId.mockReturnValue(ACTIVE_SUBSCRIPTION);
    mockIsCancellationEarly.mockReturnValue(false);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({ bookingId: "booking-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessionRestored).toBe(false);
    expect(data.message).toMatch(/isn't restored for now/i);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockDeleteBooking).toHaveBeenCalledWith("booking-1");
    // The forfeiture is tracked as reversible — subscription source, since
    // no pass was consumed for this booking (mockFindPassLedgerByBookingId
    // defaults to an empty array).
    expect(mockCreatePendingCancellationCredit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: MEMBER_USER.id, classId: "class-1", bookingId: "booking-1", creditSource: "subscription", status: "pending" })
    );
  });

  it("does not track a reversible credit when nothing was actually consumed", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockIsCancellationEarly.mockReturnValue(false);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({ bookingId: "booking-1" }, cookie);

    expect(res.status).toBe(200);
    expect(mockCreatePendingCancellationCredit).not.toHaveBeenCalled();
  });

  it("never goes below zero sessions used when restoring", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockFindSubscriptionByUserId.mockReturnValue({ ...ACTIVE_SUBSCRIPTION, sessionsUsedThisPeriod: 0 });
    mockIsCancellationEarly.mockReturnValue(true);
    const cookie = signSession({ userId: MEMBER_USER.id });

    await callBookingsCancel({ bookingId: "booking-1" }, cookie);

    expect(mockSaveSubscription.mock.calls[0][0].sessionsUsedThisPeriod).toBe(0);
  });

  it("cancels a booking gracefully when its class no longer exists", async () => {
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callBookingsCancel({ bookingId: "booking-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessionRestored).toBe(false);
    expect(mockDeleteBooking).toHaveBeenCalledWith("booking-1");
    expect(mockIssueWaitlistOffer).not.toHaveBeenCalled();
  });
});
