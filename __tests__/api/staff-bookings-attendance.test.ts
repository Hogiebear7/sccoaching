import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockFindUserById, mockFindBookingById, mockFindClassById, mockUpdateBookingAttendance } = vi.hoisted(
  () => ({
    mockFindUserById: vi.fn(),
    mockFindBookingById: vi.fn(),
    mockFindClassById: vi.fn(),
    mockUpdateBookingAttendance: vi.fn(),
  })
);

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findBookingById: mockFindBookingById,
  findClassById: mockFindClassById,
  updateBookingAttendance: mockUpdateBookingAttendance,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

// The route now authorizes booking -> class -> coach -> gym; this class is
// coached by STAFF_USER (same gym as the acting staff member).
const SOME_CLASS = { id: "class-1", coachUserId: "staff-1" };

const SOME_BOOKING = {
  id: "booking-1",
  classId: "class-1",
  userId: "member-1",
  attendedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

async function callAttendance(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/staff/bookings/attendance/route");
  const request = new NextRequest("http://localhost/api/staff/bookings/attendance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/staff/bookings/attendance", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindBookingById.mockReset();
    mockFindClassById.mockReset();
    mockFindClassById.mockReturnValue(SOME_CLASS);
    mockUpdateBookingAttendance.mockReset();
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callAttendance({ bookingId: "booking-1", attended: true });

    expect(res.status).toBe(401);
    expect(mockUpdateBookingAttendance).not.toHaveBeenCalled();
  });

  it("rejects a member session with 403", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    const cookie = signSession({ userId: MEMBER_USER.id }, MEMBER_SESSION_LIFETIME_MS);

    const res = await callAttendance({ bookingId: "booking-1", attended: true }, cookie);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toBe("Only staff can manage attendance.");
    expect(mockUpdateBookingAttendance).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking does not exist", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindBookingById.mockReturnValue(undefined);
    const cookie = signSession({ userId: STAFF_USER.id }, MEMBER_SESSION_LIFETIME_MS);

    const res = await callAttendance({ bookingId: "missing", attended: true }, cookie);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("This booking no longer exists.");
    expect(mockUpdateBookingAttendance).not.toHaveBeenCalled();
  });

  it("marks a booking attended", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    const cookie = signSession({ userId: STAFF_USER.id }, MEMBER_SESSION_LIFETIME_MS);

    const res = await callAttendance({ bookingId: "booking-1", attended: true }, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Marked attended.");
    expect(mockUpdateBookingAttendance).toHaveBeenCalledWith("booking-1", true);
  });

  it("unmarks a booking's attendance", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    mockFindBookingById.mockReturnValue(SOME_BOOKING);
    const cookie = signSession({ userId: STAFF_USER.id }, MEMBER_SESSION_LIFETIME_MS);

    const res = await callAttendance({ bookingId: "booking-1", attended: false }, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Marked not attended.");
    expect(mockUpdateBookingAttendance).toHaveBeenCalledWith("booking-1", false);
  });
});
