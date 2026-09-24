// Cross-gym READ isolation for the member schedule (lib/schedule-data.ts,
// served by GET /api/mobile/schedule). Ownership chain: class ->
// class.coachUserId -> gym, compared with the signed-in member's gym from the
// server-side user record (gymId: null is the primary gym, lib/gym-scope.ts).
// Other gyms' classes must contribute nothing — asserted both on the response
// and on the data-access calls (no booking/waitlist lookups for them). Auth
// uses the real signed-session mechanism; sameGym is deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findProfileByUserId: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findClasses: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findWaitlistEntriesByClassId: vi.fn(),
  findClassCategories: vi.fn(),
  findDeletedCategoryLabels: vi.fn(),
  resolveBookingsForUser: vi.fn(),
  hasActiveMembership: vi.fn(),
  membershipIsRequired: vi.fn(),
  getCancellationCutoffHours: vi.fn(),
  resolveSubscriptionEntitlement: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  findUserById: h.findUserById,
  findProfileByUserId: h.findProfileByUserId,
  findSubscriptionByUserId: h.findSubscriptionByUserId,
  findClasses: h.findClasses,
  findBookingsByClassId: h.findBookingsByClassId,
  findWaitlistEntriesByClassId: h.findWaitlistEntriesByClassId,
  findClassCategories: h.findClassCategories,
  findDeletedCategoryLabels: h.findDeletedCategoryLabels,
}));
vi.mock("@/lib/bookings", () => ({ resolveBookingsForUser: h.resolveBookingsForUser }));
vi.mock("@/lib/membership", () => ({
  hasActiveMembership: h.hasActiveMembership,
  membershipIsRequired: h.membershipIsRequired,
}));
vi.mock("@/lib/scheduling", () => ({ getCancellationCutoffHours: h.getCancellationCutoffHours }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: h.resolveSubscriptionEntitlement }));

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const user = (id: string, role: string, gymId: string | null) => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });
const COACH_A = user("coach-a", "coach", null);
const COACH_A2 = user("coach-a2", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const USERS = [COACH_A, COACH_A2, COACH_B, MEMBER_A, MEMBER_B];

const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const cls = (id: string, coachUserId: string, date: string, startTime: string) => ({
  id,
  title: `Class ${id}`,
  category: "strength",
  date,
  startTime,
  durationMins: 60,
  capacity: 10,
  coachUserId,
  imageUrl: null,
  imageAlt: null,
});
const CLASS_A_LATE = cls("class-a-late", COACH_A.id, isoDay(4), "18:00");
const CLASS_A_EARLY = cls("class-a-early", COACH_A2.id, isoDay(2), "07:00");
const CLASS_B = cls("class-b", COACH_B.id, isoDay(3), "09:00");
const CLASS_ORPHAN = cls("class-orphan", "coach-gone", isoDay(3), "10:00");
const CLASS_A_PAST = cls("class-a-past", COACH_A.id, isoDay(-3), "09:00");
const CLASSES = [CLASS_A_LATE, CLASS_B, CLASS_ORPHAN, CLASS_A_PAST, CLASS_A_EARLY];

const sessionHeaders = (userId?: string): HeadersInit =>
  userId ? { Cookie: `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}` } : {};

async function getSchedule(sessionUserId?: string, query = "") {
  const { GET } = await import("@/app/api/mobile/schedule/route");
  return GET(new NextRequest(`http://localhost/api/mobile/schedule${query}`, { headers: sessionHeaders(sessionUserId) }));
}

const classIds = async (res: Response) => (await res.json()).data.classes.map((c: { id: string }) => c.id);
const bookingLookups = () => h.findBookingsByClassId.mock.calls.map((c) => c[0]);
const waitlistLookups = () => h.findWaitlistEntriesByClassId.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => USERS.find((u) => u.id === id));
  h.findProfileByUserId.mockImplementation((id: string) => ({ userId: id, fullName: id }));
  h.findSubscriptionByUserId.mockReturnValue(undefined);
  h.findClasses.mockImplementation(() => CLASSES);
  h.findBookingsByClassId.mockReturnValue([]);
  h.findWaitlistEntriesByClassId.mockReturnValue([]);
  h.findClassCategories.mockReturnValue([{ id: "strength", label: "Strength" }]);
  h.findDeletedCategoryLabels.mockReturnValue({});
  h.resolveBookingsForUser.mockReturnValue([]);
  h.hasActiveMembership.mockReturnValue(true);
  h.membershipIsRequired.mockReturnValue(false);
  h.getCancellationCutoffHours.mockReturnValue(12);
  h.resolveSubscriptionEntitlement.mockReturnValue(null);
});

describe("GET /api/mobile/schedule — gym-scoped class list", () => {
  it("a gym A member sees only gym A future classes, in the existing order, with the coach's email", async () => {
    const res = await getSchedule(MEMBER_A.id);

    expect(res.status).toBe(200);
    // Past class excluded (existing behavior); gym B and unresolvable-coach classes excluded.
    expect(await classIds(res)).toEqual(["class-a-late", "class-a-early"]);
    const body = await (await getSchedule(MEMBER_A.id)).json();
    expect(body.data.classes[0]).toMatchObject({ coachEmail: "coach-a@x.test", capacity: 10, bookedCount: 0, isFull: false });
    expect(body.data.classes[1].coachEmail).toBe("coach-a2@x.test");
  });

  it("a gym B member sees only gym B classes", async () => {
    const res = await getSchedule(MEMBER_B.id);

    expect(await classIds(res)).toEqual(["class-b"]);
  });

  it("never looks up bookings or waitlists for another gym's (or an unowned) class", async () => {
    await getSchedule(MEMBER_A.id);

    expect(bookingLookups().sort()).toEqual(["class-a-early", "class-a-late"]);
    expect(waitlistLookups().sort()).toEqual(["class-a-early", "class-a-late"]);
    expect(bookingLookups()).not.toContain("class-b");
    expect(bookingLookups()).not.toContain("class-orphan");
  });

  it("does not leak another gym's class identifiers or coach anywhere in the payload", async () => {
    const res = await getSchedule(MEMBER_A.id);
    const text = JSON.stringify(await res.json());

    expect(text).not.toContain("class-b");
    expect(text).not.toContain("coach-b@x.test");
    expect(text).not.toContain("class-orphan");
  });

  it("fails closed for a class whose coach can't be resolved", async () => {
    h.findClasses.mockReturnValue([CLASS_ORPHAN]);

    const res = await getSchedule(MEMBER_A.id);

    expect(res.status).toBe(200);
    expect(await classIds(res)).toEqual([]);
  });

  it("returns an empty class list (not an error) when the member's gym has no upcoming classes", async () => {
    h.findClasses.mockReturnValue([CLASS_B]);

    const res = await getSchedule(MEMBER_A.id);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.classes).toEqual([]);
    expect(body.data.cancellationCutoffHours).toBe(12);
  });

  it("ignores a client-supplied gymId query parameter", async () => {
    const res = await getSchedule(MEMBER_A.id, "?gymId=gym-b");

    expect(await classIds(res)).toEqual(["class-a-late", "class-a-early"]);
  });

  it("keeps the rest of the response shape (bookings, categories, membership flags) unchanged", async () => {
    const res = await getSchedule(MEMBER_A.id);
    const { data } = await res.json();

    expect(Object.keys(data).sort()).toEqual(
      [
        "cancellationCutoffHours",
        "categories",
        "classes",
        "deletedLabels",
        "noActiveMembership",
        "pastBookings",
        "remainingSessions",
        "upcomingBookings",
      ].sort()
    );
    expect(data.noActiveMembership).toBe(false);
    expect(data.upcomingBookings).toEqual([]);
  });

  it("still marks the member's own same-gym booking and waitlist state on their gym's classes", async () => {
    h.resolveBookingsForUser.mockReturnValue([]);
    h.findBookingsByClassId.mockImplementation((id: string) =>
      id === "class-a-late" ? [{ id: "bk-1", classId: id, userId: MEMBER_A.id }] : []
    );
    h.findWaitlistEntriesByClassId.mockImplementation((id: string) =>
      id === "class-a-early"
        ? [{ id: "wl-1", classId: id, userId: MEMBER_A.id, offerState: "queued", offerExpiresAt: null }]
        : []
    );

    const { data } = await (await getSchedule(MEMBER_A.id)).json();
    const late = data.classes.find((c: { id: string }) => c.id === "class-a-late");
    const early = data.classes.find((c: { id: string }) => c.id === "class-a-early");

    expect(late.bookedCount).toBe(1);
    expect(early).toMatchObject({ isWaitlistedByMe: true, waitlistPosition: 1, waitlistEntryId: "wl-1" });
  });
});

describe("GET /api/mobile/schedule — authentication unchanged", () => {
  it("rejects an unauthenticated request with 401 and loads no class data", async () => {
    const res = await getSchedule();

    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("Not signed in.");
    expect(h.findClasses).not.toHaveBeenCalled();
  });

  it("rejects a session whose user no longer exists with 401", async () => {
    const res = await getSchedule("ghost-user");

    expect(res.status).toBe(401);
    expect(h.findClasses).not.toHaveBeenCalled();
  });
});
