import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindClassById,
  mockFindBookingsByClassId,
  mockDeleteBooking,
  mockDeleteClass,
  mockDeleteWaitlistEntry,
  mockFindAllWaitlistEntries,
  mockFindSubscriptionByUserId,
  mockSaveSubscription,
  mockCreateNotification,
  mockReversePassConsumption,
  mockFindClassSeriesById,
  mockSaveClassSeries,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassById: vi.fn(),
  mockFindBookingsByClassId: vi.fn(),
  mockDeleteBooking: vi.fn(),
  mockDeleteClass: vi.fn(),
  mockDeleteWaitlistEntry: vi.fn(),
  mockFindAllWaitlistEntries: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockSaveSubscription: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockReversePassConsumption: vi.fn(),
  mockFindClassSeriesById: vi.fn(),
  mockSaveClassSeries: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  // Class-cancelled email helper reads the member profile; undefined here makes
  // the fire-and-forget email a no-op (these tests assert deletion/pass logic).
  findProfileByUserId: vi.fn(),
  isTransactionalEmailEnabled: vi.fn(() => true),
  findClassById: mockFindClassById,
  findBookingsByClassId: mockFindBookingsByClassId,
  deleteBooking: mockDeleteBooking,
  deleteClass: mockDeleteClass,
  deleteWaitlistEntry: mockDeleteWaitlistEntry,
  findAllWaitlistEntries: mockFindAllWaitlistEntries,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  saveSubscription: mockSaveSubscription,
  createNotification: mockCreateNotification,
  findClassSeriesById: mockFindClassSeriesById,
  saveClassSeries: mockSaveClassSeries,
}));

vi.mock("@/lib/payments", () => ({
  reversePassConsumption: mockReversePassConsumption,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

function futureDateString(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

const FUTURE_CLASS = {
  id: "class-1",
  title: "Evening Strength",
  category: "strength",
  coachUserId: "staff-1",
  date: futureDateString(3),
  startTime: "18:00",
  durationMins: 60,
  capacity: 10,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const PAST_CLASS = { ...FUTURE_CLASS, id: "class-past", date: "2026-01-05" };

const BOOKING_A = { id: "book-a", classId: "class-1", userId: "member-1", attendedAt: null, createdAt: "x" };
const BOOKING_B = { id: "book-b", classId: "class-1", userId: "member-2", attendedAt: null, createdAt: "x" };

const SUBSCRIPTION = {
  userId: "member-2",
  planId: "plan-1",
  status: "active" as const,
  provider: "none" as const,
  providerCustomerId: null,
  providerSubscriptionId: null,
  providerSetupOrderId: null,
  currentPeriodEnd: null,
  lastWebhookEventAt: null,
  sessionsUsedThisPeriod: 3,
  extraSessionGrants: [],
  periodLapsedNotifiedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callDelete(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/staff/classes/delete/route");
  const request = new NextRequest("http://localhost/api/staff/classes/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/staff/classes/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindClassById.mockReturnValue(FUTURE_CLASS);
    mockFindBookingsByClassId.mockReturnValue([]);
    mockFindAllWaitlistEntries.mockReturnValue([]);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockReversePassConsumption.mockReturnValue(false);
  });

  it("rejects non-staff sessions", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    const res = await callDelete({ id: "class-1" }, signSession({ userId: MEMBER_USER.id }));

    expect(res.status).toBe(403);
    expect(mockDeleteClass).not.toHaveBeenCalled();
  });

  it("refuses to delete a class that has already started", async () => {
    mockFindClassById.mockReturnValue(PAST_CLASS);
    const res = await callDelete({ id: "class-past" }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(409);
    expect(mockDeleteClass).not.toHaveBeenCalled();
    expect(mockDeleteBooking).not.toHaveBeenCalled();
  });

  it("deletes an empty upcoming class without touching balances", async () => {
    const res = await callDelete({ id: "class-1" }, signSession({ userId: STAFF_USER.id }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Class deleted.");
    expect(mockDeleteClass).toHaveBeenCalledWith("class-1");
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("restores a pack pass via ledger reversal when the booking consumed one", async () => {
    mockFindBookingsByClassId.mockReturnValue([BOOKING_A]);
    mockReversePassConsumption.mockReturnValue(true);

    const res = await callDelete({ id: "class-1" }, signSession({ userId: STAFF_USER.id }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockReversePassConsumption).toHaveBeenCalledWith(
      "book-a",
      expect.stringContaining("cancelled by the club")
    );
    // Pack pool paid — the monthly counter must not also be decremented.
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    expect(mockDeleteBooking).toHaveBeenCalledWith("book-a");
    expect(data.message).toContain("1 booking");
    expect(data.message).toContain("1 pass");
  });

  it("decrements the monthly counter when the booking used plan allowance", async () => {
    mockFindBookingsByClassId.mockReturnValue([BOOKING_B]);
    mockFindSubscriptionByUserId.mockReturnValue(SUBSCRIPTION);

    const res = await callDelete({ id: "class-1" }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).toHaveBeenCalledTimes(1);
    expect(mockSaveSubscription.mock.calls[0][0].sessionsUsedThisPeriod).toBe(2);
  });

  it("never drives the monthly counter below zero", async () => {
    mockFindBookingsByClassId.mockReturnValue([BOOKING_B]);
    mockFindSubscriptionByUserId.mockReturnValue({ ...SUBSCRIPTION, sessionsUsedThisPeriod: 0 });

    const res = await callDelete({ id: "class-1" }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(200);
    expect(mockSaveSubscription).not.toHaveBeenCalled();
    // The booking is still removed even though there was nothing to refund.
    expect(mockDeleteBooking).toHaveBeenCalledWith("book-b");
  });

  it("deleting a series occurrence tombstones its date so it never regenerates", async () => {
    mockFindClassById.mockReturnValue({ ...FUTURE_CLASS, seriesId: "series-1" });
    mockFindClassSeriesById.mockReturnValue({ id: "series-1", skippedDates: ["2026-01-01"] });

    const res = await callDelete({ id: "class-1" }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(200);
    const saved = mockSaveClassSeries.mock.calls[0][0];
    expect(saved.skippedDates).toContain(FUTURE_CLASS.date);
    expect(saved.skippedDates).toContain("2026-01-01");
    expect(mockDeleteClass).toHaveBeenCalledWith("class-1");
  });

  it("notifies each booked member and purges the class waitlist", async () => {
    mockFindBookingsByClassId.mockReturnValue([BOOKING_A, BOOKING_B]);
    mockFindSubscriptionByUserId.mockReturnValue(SUBSCRIPTION);
    mockFindAllWaitlistEntries.mockReturnValue([
      { id: "wl-1", classId: "class-1", userId: "member-3" },
      { id: "wl-2", classId: "other-class", userId: "member-4" },
    ]);

    const res = await callDelete({ id: "class-1" }, signSession({ userId: STAFF_USER.id }));

    expect(res.status).toBe(200);
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification.mock.calls[0][0]).toMatchObject({
      userId: "member-1",
      type: "cancellation",
      dedupeKey: "class-deleted:class-1:member-1",
    });
    // Only this class's waitlist entries are purged.
    expect(mockDeleteWaitlistEntry).toHaveBeenCalledTimes(1);
    expect(mockDeleteWaitlistEntry).toHaveBeenCalledWith("wl-1");
  });

  it("claims the pass was returned only when the credit was actually restored", async () => {
    mockFindBookingsByClassId.mockReturnValue([BOOKING_A]);
    mockReversePassConsumption.mockReturnValue(true); // credit genuinely restored

    await callDelete({ id: "class-1" }, signSession({ userId: STAFF_USER.id }));

    const body = mockCreateNotification.mock.calls[0][0].body;
    expect(body).toContain("has been cancelled by the club.");
    expect(body).toContain("Your class pass has been returned.");
  });

  it("stays neutral in-app when no credit was restored (no false credit claim)", async () => {
    mockFindBookingsByClassId.mockReturnValue([BOOKING_A]);
    mockReversePassConsumption.mockReturnValue(false);
    mockFindSubscriptionByUserId.mockReturnValue(undefined); // nothing to refund

    await callDelete({ id: "class-1" }, signSession({ userId: STAFF_USER.id }));

    const body = mockCreateNotification.mock.calls[0][0].body;
    expect(body).toContain("has been cancelled by the club.");
    expect(body).not.toContain("returned");
    expect(body).not.toContain("class pass");
  });
});
