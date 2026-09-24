// Gym isolation for app/api/staff/bookings/attendance/route.ts. Ownership
// chain: booking -> class -> class.coachUserId -> gym, compared with the acting
// staff member's gym. A cross-gym booking gets the same "This booking no longer
// exists." 404 as a missing one, before any attendance write. (The pre-existing
// staff-bookings-attendance.test.ts covers the same-gym happy path and
// baseline auth; this file adds the two-gym cases.) Auth uses the real
// signed-session mechanism; sameGymAsStaff and can() are not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findBookingById: vi.fn(),
  findClassById: vi.fn(),
  updateBookingAttendance: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const COACH_A = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const COACH_B = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const MEMBER_A = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };

const CLASSES = [
  { id: "class-a", coachUserId: COACH_A.id },
  { id: "class-b", coachUserId: COACH_B.id },
  { id: "class-nocoach", coachUserId: "coach-gone" },
];
const BOOKINGS = [
  { id: "booking-a", classId: "class-a", userId: "member-a" },
  { id: "booking-b", classId: "class-b", userId: "member-b" },
  { id: "booking-orphan-class", classId: "class-gone", userId: "member-a" },
  { id: "booking-orphan-coach", classId: "class-nocoach", userId: "member-a" },
];

const NOT_FOUND = { success: false, message: "This booking no longer exists." };

async function post(body: unknown, sessionUserId?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/staff/bookings/attendance/route");
  const req = new NextRequest("http://localhost/api/staff/bookings/attendance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    body: rawBody ?? JSON.stringify(body),
  });
  return POST(req);
}

const mark = (bookingId: string, attended: boolean, sessionUserId: string = COACH_A.id) =>
  post({ bookingId, attended }, sessionUserId);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [COACH_A, COACH_B, MEMBER_A].find((u) => u.id === id));
  h.findBookingById.mockImplementation((id: string) => BOOKINGS.find((b) => b.id === id));
  h.findClassById.mockImplementation((id: string) => CLASSES.find((c) => c.id === id));
});

describe("POST /api/staff/bookings/attendance — same-gym authorization", () => {
  it("marks and unmarks attendance on a same-gym booking (existing responses)", async () => {
    const attended = await mark("booking-a", true);
    expect(attended.status).toBe(200);
    expect((await attended.json()).message).toBe("Marked attended.");
    expect(h.updateBookingAttendance).toHaveBeenLastCalledWith("booking-a", true);

    const unmarked = await mark("booking-a", false);
    expect(unmarked.status).toBe(200);
    expect((await unmarked.json()).message).toBe("Marked not attended.");
    expect(h.updateBookingAttendance).toHaveBeenLastCalledWith("booking-a", false);
  });

  it("works within the second gym too", async () => {
    const res = await mark("booking-b", true, COACH_B.id);

    expect(res.status).toBe(200);
    expect(h.updateBookingAttendance).toHaveBeenCalledWith("booking-b", true);
  });

  it("denies a cross-gym booking with the existing 404 — identical to a missing booking — and writes nothing", async () => {
    const crossGym = await mark("booking-b", true);
    const crossGymBody = await crossGym.json();
    const missing = await mark("booking-missing", true);

    expect(crossGym.status).toBe(404);
    expect(crossGymBody).toEqual(NOT_FOUND);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(crossGymBody);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("denies the reverse direction too, for both mark and unmark", async () => {
    const mark1 = await mark("booking-a", true, COACH_B.id);
    const mark2 = await mark("booking-a", false, COACH_B.id);

    expect(mark1.status).toBe(404);
    expect(mark2.status).toBe(404);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("fails closed when the booking's class or the class's coach can't be resolved", async () => {
    expect((await mark("booking-orphan-class", true)).status).toBe(404);
    expect((await mark("booking-orphan-coach", true)).status).toBe(404);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId", async () => {
    const res = await post({ bookingId: "booking-b", attended: true, gymId: null }, COACH_A.id);

    expect(res.status).toBe(404);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/bookings/attendance — authentication, capability, validation unchanged", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await post({ bookingId: "booking-a", attended: true });

    expect(res.status).toBe(401);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("rejects a member with 403, and checks capability before the gym (cross-gym member is 403, not 404)", async () => {
    const own = await mark("booking-a", true, MEMBER_A.id);
    const crossGym = await mark("booking-b", true, MEMBER_A.id);

    expect(own.status).toBe(403);
    expect(crossGym.status).toBe(403);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("preserves request validation", async () => {
    expect((await post(undefined, COACH_A.id, "{not json")).status).toBe(400);
    expect((await post({ attended: true }, COACH_A.id)).status).toBe(400);
    expect((await post({ bookingId: "booking-a", attended: "yes" }, COACH_A.id)).status).toBe(400);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });
});
