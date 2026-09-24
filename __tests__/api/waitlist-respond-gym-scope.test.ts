// Gym isolation for POST /api/bookings/waitlist/respond. Ownership chain:
// waitlist entry -> (entry member, entry class -> class.coachUserId) -> gym,
// each compared with the authenticated member's gym (gymId: null is the
// primary gym, lib/gym-scope.ts). The entry, its member and its class all come
// from the stored entry — never from the request. The check runs before ANY
// state change: no waitlist-state save, no booking, no credit use, no cascade
// offer, no email. A cross-gym or unresolvable entry gets the same 404 as a
// missing one, so it isn't revealed to exist. Auth uses the real
// signed-session mechanism; sameGym / sameGymAsStaff are deliberately not
// mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  createBooking: vi.fn(),
  findClassById: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  findWaitlistEntryById: vi.fn(),
  saveSubscription: vi.fn(),
  saveWaitlistEntry: vi.fn(),
  hasActiveMembership: vi.fn(),
  sendBookingConfirmationEmail: vi.fn(),
  resolvePendingCancellationCreditsForClass: vi.fn(),
  syncClassWorkoutToMember: vi.fn(),
  issueWaitlistOffer: vi.fn(),
  syncBookingToWeeklyTraining: vi.fn(),
  consumePurchasedPass: vi.fn(),
  purchasedPassBalance: vi.fn(),
  resolveSubscriptionEntitlement: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  createBooking: h.createBooking,
  findClassById: h.findClassById,
  findSubscriptionByUserId: h.findSubscriptionByUserId,
  findUserById: h.findUserById,
  findWaitlistEntryById: h.findWaitlistEntryById,
  saveSubscription: h.saveSubscription,
  saveWaitlistEntry: h.saveWaitlistEntry,
}));
vi.mock("@/lib/membership", () => ({ hasActiveMembership: h.hasActiveMembership }));
vi.mock("@/lib/booking-emails", () => ({ sendBookingConfirmationEmail: h.sendBookingConfirmationEmail }));
vi.mock("@/lib/cancellation-credits", () => ({
  resolvePendingCancellationCreditsForClass: h.resolvePendingCancellationCreditsForClass,
}));
vi.mock("@/lib/class-workout-sync", () => ({ syncClassWorkoutToMember: h.syncClassWorkoutToMember }));
vi.mock("@/lib/scheduling", () => ({ issueWaitlistOffer: h.issueWaitlistOffer }));
vi.mock("@/lib/weekly-training-sync", () => ({ syncBookingToWeeklyTraining: h.syncBookingToWeeklyTraining }));
vi.mock("@/lib/payments", () => ({
  consumePurchasedPass: h.consumePurchasedPass,
  purchasedPassBalance: h.purchasedPassBalance,
}));
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: h.resolveSubscriptionEntitlement }));

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const user = (id: string, role: string, gymId: string | null) => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });
const COACH_A = user("coach-a", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_A2 = user("member-a2", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const USERS = [COACH_A, COACH_B, MEMBER_A, MEMBER_A2, MEMBER_B];

const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const CLASS_A = { id: "class-a", coachUserId: COACH_A.id, date: future, startTime: "18:00", category: "strength", capacity: 1 };
const CLASS_B = { id: "class-b", coachUserId: COACH_B.id, date: future, startTime: "18:00", category: "strength", capacity: 1 };
const CLASS_NOCOACH = { id: "class-nocoach", coachUserId: "coach-gone", date: future, startTime: "18:00", category: "strength", capacity: 1 };
const CLASS_BLANKCOACH = { id: "class-blank", coachUserId: "", date: future, startTime: "18:00", category: "strength", capacity: 1 };
const CLASSES = [CLASS_A, CLASS_B, CLASS_NOCOACH, CLASS_BLANKCOACH];

const entry = (id: string, userId: string, classId: string, offerState = "offered") => ({
  id,
  userId,
  classId,
  offerState,
  offerExpiresAt: null,
  warningNotifiedAt: null,
  resolvedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});
const ENTRIES = [
  entry("e-a", MEMBER_A.id, CLASS_A.id),
  entry("e-a2", MEMBER_A2.id, CLASS_A.id), // another gym-A member's offer
  entry("e-b", MEMBER_B.id, CLASS_B.id),
  entry("e-a-in-b-class", MEMBER_A.id, CLASS_B.id), // gym-A member, gym-B class
  entry("e-b-in-a-class", MEMBER_B.id, CLASS_A.id), // gym-B member, gym-A class
  entry("e-a-nocoach", MEMBER_A.id, CLASS_NOCOACH.id),
  entry("e-a-blankcoach", MEMBER_A.id, CLASS_BLANKCOACH.id),
  entry("e-a-noclass", MEMBER_A.id, "class-gone"),
  entry("e-ghost-member", "member-gone", CLASS_A.id),
];

async function respond(body: unknown, sessionUserId?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/bookings/waitlist/respond/route");
  return POST(
    new NextRequest("http://localhost/api/bookings/waitlist/respond", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionUserId
          ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
          : {}),
      },
      body: rawBody ?? JSON.stringify(body),
    })
  );
}

const accept = (entryId: string, sessionUserId: string = MEMBER_A.id) => respond({ entryId, action: "accept" }, sessionUserId);
const reject = (entryId: string, sessionUserId: string = MEMBER_A.id) => respond({ entryId, action: "reject" }, sessionUserId);

function expectNothingMutated() {
  expect(h.saveWaitlistEntry).not.toHaveBeenCalled();
  expect(h.createBooking).not.toHaveBeenCalled();
  expect(h.saveSubscription).not.toHaveBeenCalled();
  expect(h.consumePurchasedPass).not.toHaveBeenCalled();
  expect(h.issueWaitlistOffer).not.toHaveBeenCalled();
  expect(h.resolvePendingCancellationCreditsForClass).not.toHaveBeenCalled();
  expect(h.syncClassWorkoutToMember).not.toHaveBeenCalled();
  expect(h.syncBookingToWeeklyTraining).not.toHaveBeenCalled();
  expect(h.sendBookingConfirmationEmail).not.toHaveBeenCalled();
}

const NOT_FOUND = { success: false, message: "Waitlist offer not found." };

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => USERS.find((u) => u.id === id));
  h.findWaitlistEntryById.mockImplementation((id: string) => ENTRIES.find((e) => e.id === id));
  h.findClassById.mockImplementation((id: string) => CLASSES.find((c) => c.id === id));
  h.hasActiveMembership.mockReturnValue(true);
  h.findSubscriptionByUserId.mockReturnValue(undefined);
  h.resolveSubscriptionEntitlement.mockReturnValue(null);
  h.purchasedPassBalance.mockReturnValue(0);
});

describe("POST /api/bookings/waitlist/respond — same-gym authorization", () => {
  it("lets a member accept their own same-gym offer (existing behavior)", async () => {
    const res = await accept("e-a");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Booking confirmed! You're booked in." });
    expect(h.createBooking).toHaveBeenCalledWith(expect.objectContaining({ classId: CLASS_A.id, userId: MEMBER_A.id }));
    expect(h.saveWaitlistEntry).toHaveBeenCalledWith(expect.objectContaining({ id: "e-a", offerState: "accepted" }));
    expect(h.sendBookingConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("lets a member decline their own same-gym offer and cascades to the next person (existing behavior)", async () => {
    const res = await reject("e-a");

    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("Offer declined. You've been removed from the waitlist.");
    expect(h.saveWaitlistEntry).toHaveBeenCalledWith(expect.objectContaining({ id: "e-a", offerState: "rejected" }));
    expect(h.issueWaitlistOffer).toHaveBeenCalledWith(CLASS_A.id);
    expect(h.createBooking).not.toHaveBeenCalled();
  });

  it("works within the second gym too (gym-B member, gym-B class)", async () => {
    const res = await accept("e-b", MEMBER_B.id);

    expect(res.status).toBe(200);
    expect(h.createBooking).toHaveBeenCalledWith(expect.objectContaining({ classId: CLASS_B.id, userId: MEMBER_B.id }));
  });

  it("keeps a repeat response consistent: an already-accepted entry is still the existing 409", async () => {
    h.findWaitlistEntryById.mockReturnValue(entry("e-a", MEMBER_A.id, CLASS_A.id, "accepted"));

    const res = await accept("e-a");

    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("This offer has already been accepted.");
    expectNothingMutated();
  });

  it("denies a gym-A member acting on an offer for a gym-B class with the missing-entry 404, mutating nothing", async () => {
    for (const action of ["accept", "reject"]) {
      const res = await respond({ entryId: "e-a-in-b-class", action }, MEMBER_A.id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expectNothingMutated();

    const missing = await accept("no-such-entry");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(NOT_FOUND);
  });

  it("denies a gym-B member's own offer on a gym-A class the same way", async () => {
    const res = await accept("e-b-in-a-class", MEMBER_B.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expectNothingMutated();
  });

  it("denies a cross-gym member using another gym's entry id; existence isn't revealed", async () => {
    const res = await accept("e-b", MEMBER_A.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expectNothingMutated();
  });

  it("still denies another same-gym member's offer with the existing 403, mutating nothing", async () => {
    const res = await accept("e-a2", MEMBER_A.id);

    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("This offer is not for your account.");
    expectNothingMutated();
  });

  it("denies an entry whose member can't be resolved, mutating nothing", async () => {
    const res = await accept("e-ghost-member");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expectNothingMutated();
  });

  it("fails closed when the entry's class no longer exists (accept and reject alike)", async () => {
    expect((await accept("e-a-noclass")).status).toBe(404);
    expect((await reject("e-a-noclass")).status).toBe(404);
    expectNothingMutated();
  });

  it("fails closed when the class's coach can't be resolved, or is blank", async () => {
    for (const id of ["e-a-nocoach", "e-a-blankcoach"]) {
      const res = await accept(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expectNothingMutated();
  });

  it("ignores client-supplied gymId / userId in the body", async () => {
    const res = await respond({ entryId: "e-a-in-b-class", action: "accept", gymId: null, userId: MEMBER_B.id }, MEMBER_A.id);

    expect(res.status).toBe(404);
    expectNothingMutated();
  });
});

describe("POST /api/bookings/waitlist/respond — authentication and validation unchanged", () => {
  it("rejects an unauthenticated request with 401, mutating nothing", async () => {
    const res = await respond({ entryId: "e-a", action: "accept" });

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("You must be signed in.");
    expect(h.findWaitlistEntryById).not.toHaveBeenCalled();
    expectNothingMutated();
  });

  it("rejects a session whose user no longer exists with 401", async () => {
    const res = await respond({ entryId: "e-a", action: "accept" }, "ghost-user");

    expect(res.status).toBe(401);
    expectNothingMutated();
  });

  it("preserves request validation", async () => {
    const badJson = await respond(undefined, MEMBER_A.id, "{not json");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).message).toBe("Invalid JSON body.");

    const noEntry = await respond({ action: "accept" }, MEMBER_A.id);
    expect(noEntry.status).toBe(400);
    expect((await noEntry.json()).message).toBe("entryId is required.");

    const badAction = await respond({ entryId: "e-a", action: "maybe" }, MEMBER_A.id);
    expect(badAction.status).toBe(400);
    expect((await badAction.json()).message).toBe("action must be 'accept' or 'reject'.");

    expectNothingMutated();
  });
});
