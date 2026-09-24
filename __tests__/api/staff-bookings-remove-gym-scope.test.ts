// Gym isolation for app/api/staff/bookings/remove/route.ts. Ownership chain:
// booking -> class -> class.coachUserId -> gym, compared with the acting staff
// member's gym. A cross-gym booking gets the same "This booking no longer
// exists." 404 as a missing one, and — the point of this file — nothing is
// touched on denial: no pass/subscription credit restoration, no delete, no
// weekly-training sync, no waitlist offer. Auth uses the real signed-session
// mechanism; sameGymAsStaff and can() are deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findBookingById: vi.fn(),
  findClassById: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  saveSubscription: vi.fn(),
  deleteBooking: vi.fn(),
  reversePassConsumption: vi.fn(),
  issueWaitlistOffer: vi.fn(),
  removeSyncedWeeklyTrainingSession: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  findUserById: h.findUserById,
  findBookingById: h.findBookingById,
  findClassById: h.findClassById,
  findSubscriptionByUserId: h.findSubscriptionByUserId,
  saveSubscription: h.saveSubscription,
  deleteBooking: h.deleteBooking,
}));
vi.mock("@/lib/payments", () => ({ reversePassConsumption: h.reversePassConsumption }));
vi.mock("@/lib/scheduling", () => ({ issueWaitlistOffer: h.issueWaitlistOffer }));
vi.mock("@/lib/weekly-training-sync", () => ({
  removeSyncedWeeklyTrainingSession: h.removeSyncedWeeklyTrainingSession,
}));

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const COACH_A = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const COACH_B = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const MEMBER_A = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const MEMBER_B = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const CLASS_A = { id: "class-a", coachUserId: COACH_A.id };
const CLASS_B = { id: "class-b", coachUserId: COACH_B.id };
const BOOKING_A = { id: "booking-a", classId: CLASS_A.id, userId: MEMBER_A.id };
const BOOKING_B = { id: "booking-b", classId: CLASS_B.id, userId: MEMBER_B.id };
const BOOKINGS = [BOOKING_A, BOOKING_B, { id: "booking-orphan-class", classId: "class-gone", userId: MEMBER_A.id }, { id: "booking-orphan-coach", classId: "class-nocoach", userId: MEMBER_A.id }];
const CLASSES = [CLASS_A, CLASS_B, { id: "class-nocoach", coachUserId: "coach-gone" }];

const NOT_FOUND = { success: false, message: "This booking no longer exists." };

async function post(body: unknown, sessionUserId?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/staff/bookings/remove/route");
  const req = new NextRequest("http://localhost/api/staff/bookings/remove", {
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

const remove = (bookingId: string, sessionUserId: string = COACH_A.id) => post({ bookingId }, sessionUserId);

function expectNothingTouched() {
  expect(h.reversePassConsumption).not.toHaveBeenCalled();
  expect(h.findSubscriptionByUserId).not.toHaveBeenCalled();
  expect(h.saveSubscription).not.toHaveBeenCalled();
  expect(h.deleteBooking).not.toHaveBeenCalled();
  expect(h.removeSyncedWeeklyTrainingSession).not.toHaveBeenCalled();
  expect(h.issueWaitlistOffer).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [COACH_A, COACH_B, MEMBER_A, MEMBER_B].find((u) => u.id === id));
  h.findBookingById.mockImplementation((id: string) => BOOKINGS.find((b) => b.id === id));
  h.findClassById.mockImplementation((id: string) => CLASSES.find((c) => c.id === id));
  h.reversePassConsumption.mockReturnValue(false);
  h.findSubscriptionByUserId.mockReturnValue({ userId: MEMBER_A.id, sessionsUsedThisPeriod: 3 });
});

describe("POST /api/staff/bookings/remove — same-gym authorization", () => {
  it("removes a same-gym booking, restores the credit, and offers the freed spot (existing behavior)", async () => {
    const res = await remove(BOOKING_A.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: "Member removed from the class. Their credit was restored.",
    });
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ sessionsUsedThisPeriod: 2 }));
    expect(h.deleteBooking).toHaveBeenCalledWith(BOOKING_A.id);
    expect(h.removeSyncedWeeklyTrainingSession).toHaveBeenCalledWith(MEMBER_A.id, BOOKING_A.id);
    expect(h.issueWaitlistOffer).toHaveBeenCalledWith(CLASS_A.id);
  });

  it("works within the second gym too (gym-B coach, gym-B booking)", async () => {
    h.findSubscriptionByUserId.mockReturnValue(undefined);

    const res = await remove(BOOKING_B.id, COACH_B.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Member removed from the class." });
    expect(h.deleteBooking).toHaveBeenCalledWith(BOOKING_B.id);
  });

  it("denies a cross-gym booking with the existing 404 — identical to a missing booking — and touches nothing", async () => {
    const crossGym = await remove(BOOKING_B.id, COACH_A.id);
    const crossGymBody = await crossGym.json();
    expectNothingTouched();

    const missing = await remove("booking-missing", COACH_A.id);

    expect(crossGym.status).toBe(404);
    expect(crossGymBody).toEqual(NOT_FOUND);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(crossGymBody);
    expectNothingTouched();
  });

  it("denies the reverse direction too (gym-B coach, gym-A booking) and restores no credit", async () => {
    const res = await remove(BOOKING_A.id, COACH_B.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expectNothingTouched();
  });

  it("fails closed when the booking's class no longer exists", async () => {
    const res = await remove("booking-orphan-class");

    expect(res.status).toBe(404);
    expectNothingTouched();
  });

  it("fails closed when the class's coach can't be resolved", async () => {
    const res = await remove("booking-orphan-coach");

    expect(res.status).toBe(404);
    expectNothingTouched();
  });

  it("ignores a client-supplied gymId", async () => {
    const res = await post({ bookingId: BOOKING_B.id, gymId: null }, COACH_A.id);

    expect(res.status).toBe(404);
    expectNothingTouched();
  });
});

describe("POST /api/staff/bookings/remove — authentication, capability, validation unchanged", () => {
  it("rejects an unauthenticated request with 401, mutating nothing", async () => {
    const res = await post({ bookingId: BOOKING_A.id });

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("You must be signed in to manage bookings.");
    expectNothingTouched();
  });

  it("rejects a member (no classes.manage) with 403, even for their own booking", async () => {
    const res = await remove(BOOKING_A.id, MEMBER_A.id);

    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("Only staff can remove a member from a class.");
    expectNothingTouched();
  });

  it("checks the capability before the gym: an unauthorized cross-gym request is 403, not 404", async () => {
    const res = await remove(BOOKING_B.id, MEMBER_A.id);

    expect(res.status).toBe(403);
    expectNothingTouched();
  });

  it("preserves request validation", async () => {
    const badJson = await post(undefined, COACH_A.id, "{not json");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).message).toBe("Invalid JSON body.");

    const noBooking = await post({}, COACH_A.id);
    expect(noBooking.status).toBe(400);
    expect((await noBooking.json()).message).toBe("A booking is required.");

    expectNothingTouched();
  });
});
