// Gym isolation for app/api/bookings/waitlist/join/route.ts. Ownership chain:
// class -> class.coachUserId -> gym, compared with the member's gym — the same
// check as app/api/bookings/create/route.ts. A cross-gym class gets the same
// "This class no longer exists." 404 as a missing one, BEFORE every other check
// (including the "already started" 409, which would otherwise reveal the class)
// and before any waitlist entry is created.
//
// Offer acceptance: app/api/bookings/waitlist/respond/route.ts creates the
// booking directly from an existing waitlist entry (it has no gym check of its
// own), and issueWaitlistOffer only promotes entries that already exist. So the
// join gate is what keeps offer acceptance gym-scoped: a cross-gym member can
// never get an entry, hence never an offer to accept. The tests below assert
// that no entry is ever created for a cross-gym join. Auth uses the real
// signed-session mechanism; sameGymAsStaff is deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findClassById: vi.fn(),
  findBookingsByUserId: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findWaitlistEntryByClassAndUser: vi.fn(),
  findWaitlistEntriesByClassId: vi.fn(),
  createWaitlistEntry: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/membership", () => ({ membershipIsRequired: () => false, hasActiveMembership: () => true }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: () => undefined }));

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const COACH_A = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const COACH_B = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const MEMBER_A = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const MEMBER_B = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const klass = (id: string, coachUserId: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: "Evening Strength",
  category: "strength" as const,
  coachUserId,
  date: "2099-12-25",
  startTime: "18:00",
  durationMins: 60,
  capacity: 1,
  ...overrides,
});
const CLASSES = [
  klass("class-a", COACH_A.id),
  klass("class-b", COACH_B.id),
  klass("class-nocoach", "coach-gone"),
  klass("class-a-started", COACH_A.id, { date: "2000-01-01" }),
  klass("class-b-started", COACH_B.id, { date: "2000-01-01" }),
];

const NOT_FOUND = { success: false, message: "This class no longer exists." };

async function post(body: unknown, sessionUserId?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/bookings/waitlist/join/route");
  const req = new NextRequest("http://localhost/api/bookings/waitlist/join", {
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

const join = (classId: string, sessionUserId: string = MEMBER_A.id) => post({ classId }, sessionUserId);

function expectNoEntryAndNoDownstreamLookups() {
  expect(h.createWaitlistEntry).not.toHaveBeenCalled();
  expect(h.findBookingsByUserId).not.toHaveBeenCalled();
  expect(h.findWaitlistEntryByClassAndUser).not.toHaveBeenCalled();
  expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  expect(h.findWaitlistEntriesByClassId).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [COACH_A, COACH_B, MEMBER_A, MEMBER_B].find((u) => u.id === id));
  h.findClassById.mockImplementation((id: string) => CLASSES.find((c) => c.id === id));
  h.findSubscriptionByUserId.mockReturnValue(undefined);
  h.findBookingsByUserId.mockReturnValue([]);
  h.findWaitlistEntryByClassAndUser.mockReturnValue(undefined);
  // A full class (capacity 1, one booking) with an empty waitlist.
  h.findBookingsByClassId.mockReturnValue([{ id: "b1" }]);
  h.findWaitlistEntriesByClassId.mockReturnValue([]);
});

describe("POST /api/bookings/waitlist/join — same-gym authorization", () => {
  it("lets a member join the waitlist of a same-gym full class (existing 201 response and entry shape)", async () => {
    const res = await join("class-a");

    expect(res.status).toBe(201);
    expect((await res.json()).message).toBe(
      "You're on the waitlist. If a spot opens up you'll receive an in-app offer to accept."
    );
    expect(h.createWaitlistEntry).toHaveBeenCalledTimes(1);
    expect(h.createWaitlistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ classId: "class-a", userId: MEMBER_A.id, offerState: "queued" })
    );
  });

  it("works within the second gym too", async () => {
    const res = await join("class-b", MEMBER_B.id);

    expect(res.status).toBe(201);
    expect(h.createWaitlistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ classId: "class-b", userId: MEMBER_B.id })
    );
  });

  it("denies a cross-gym class with the existing 404 — identical to a missing class — and creates no entry", async () => {
    const crossGym = await join("class-b");
    const crossGymBody = await crossGym.json();
    expectNoEntryAndNoDownstreamLookups();

    const missing = await join("class-missing");

    expect(crossGym.status).toBe(404);
    expect(crossGymBody).toEqual(NOT_FOUND);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(crossGymBody);
    expectNoEntryAndNoDownstreamLookups();
  });

  it("denies the reverse direction too (gym-B member, gym-A class)", async () => {
    const res = await join("class-a", MEMBER_B.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expectNoEntryAndNoDownstreamLookups();
  });

  it("runs the gym gate before the 'already started' 409, so a cross-gym class isn't revealed by its status", async () => {
    const crossGymStarted = await join("class-b-started");
    expect(crossGymStarted.status).toBe(404);
    expect(await crossGymStarted.json()).toEqual(NOT_FOUND);
    expectNoEntryAndNoDownstreamLookups();

    // Control: the existing 409 is preserved for a same-gym class that has started.
    const sameGymStarted = await join("class-a-started");
    expect(sameGymStarted.status).toBe(409);
    expect((await sameGymStarted.json()).message).toBe("This class has already started.");
    expect(h.createWaitlistEntry).not.toHaveBeenCalled();
  });

  it("fails closed when the class's coach can't be resolved", async () => {
    const res = await join("class-nocoach");

    expect(res.status).toBe(404);
    expectNoEntryAndNoDownstreamLookups();
  });

  it("ignores a client-supplied gymId", async () => {
    const res = await post({ classId: "class-b", gymId: null }, MEMBER_A.id);

    expect(res.status).toBe(404);
    expectNoEntryAndNoDownstreamLookups();
  });

  it("keeps offer acceptance gym-scoped by never creating an entry for a cross-gym join (nothing exists to offer or accept)", async () => {
    await join("class-b", MEMBER_A.id);
    await join("class-a", MEMBER_B.id);

    expect(h.createWaitlistEntry).not.toHaveBeenCalled();
  });
});

describe("POST /api/bookings/waitlist/join — authentication and validation unchanged", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await post({ classId: "class-a" });

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("You must be signed in to join a waitlist.");
    expect(h.createWaitlistEntry).not.toHaveBeenCalled();
  });

  it("preserves request validation and existing eligibility responses", async () => {
    const badJson = await post(undefined, MEMBER_A.id, "{not json");
    expect(badJson.status).toBe(400);
    const noClass = await post({}, MEMBER_A.id);
    expect(noClass.status).toBe(400);
    expect((await noClass.json()).message).toBe("A class is required.");
    expect(h.createWaitlistEntry).not.toHaveBeenCalled();

    h.findBookingsByClassId.mockReturnValue([]); // class has space
    const hasSpace = await join("class-a");
    expect(hasSpace.status).toBe(409);
    expect((await hasSpace.json()).message).toBe("This class still has space — book it directly instead.");

    h.findBookingsByClassId.mockReturnValue([{ id: "b1" }]);
    h.findWaitlistEntryByClassAndUser.mockReturnValue({ id: "existing" });
    const twice = await join("class-a");
    expect(twice.status).toBe(409);
    expect(h.createWaitlistEntry).not.toHaveBeenCalled();
  });
});
