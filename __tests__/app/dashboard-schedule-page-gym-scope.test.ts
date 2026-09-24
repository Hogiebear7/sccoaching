// Cross-gym READ isolation for the web member schedule page
// app/(dashboard)/dashboard/schedule/page.tsx (the web counterpart of
// lib/schedule-data.ts, covered for mobile by
// __tests__/api/mobile-schedule-gym-scope.test.ts). The page is a plain async
// Server Component, so calling it returns an UNrendered element whose props
// (handed to ScheduleView) can be inspected without a DOM. Ownership chain:
// class -> class.coachUserId -> gym, compared with the signed-in member's gym
// from the server-side user record (gymId: null is the primary gym). Beyond
// the props, the data-access calls are asserted: no booking/waitlist lookups
// for another gym's (or an unowned) class. Auth uses the real signed-session
// mechanism; sameGym is deliberately not mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockCookies } = vi.hoisted(() => ({ mockCookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mockCookies }));

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
vi.mock("@/app/(dashboard)/dashboard/schedule/ScheduleView", () => ({ ScheduleView: () => null }));

type Cls = { id: string; coachEmail: string; bookedCount: number };
type Props = {
  classes: Cls[];
  upcomingBookings: { bookingId: string }[];
  categories: unknown[];
  cancellationCutoffHours: number;
  noActiveMembership: boolean;
};

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

function sessionCookieStore(userId: string) {
  const token = signSession({ userId }, MEMBER_SESSION_LIFETIME_MS);
  return { get: (name: string) => (name === "session" ? { value: token } : undefined) };
}
const NO_SESSION = { get: () => undefined };

// The page takes no props: a client-supplied gymId could only arrive via
// searchParams, which the page never reads. Pass one anyway to prove it.
async function callPage(...args: unknown[]) {
  const { default: Page } = await import("@/app/(dashboard)/dashboard/schedule/page");
  return (Page as (...a: unknown[]) => Promise<{ props: Props }>)(...args);
}

const classIds = (props: Props) => props.classes.map((c) => c.id);
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
  mockCookies.mockResolvedValue(sessionCookieStore(MEMBER_A.id));
});

describe("DashboardSchedulePage — same-gym classes only", () => {
  it("a gym A member sees only gym A future classes, in the existing order, with the coach's email", async () => {
    const { props } = await callPage();

    // Past class excluded (existing behavior); gym B and unresolvable-coach classes excluded.
    expect(classIds(props)).toEqual(["class-a-late", "class-a-early"]);
    expect(props.classes[0]).toMatchObject({ coachEmail: "coach-a@x.test", capacity: 10, bookedCount: 0, isFull: false });
    expect(props.classes[1].coachEmail).toBe("coach-a2@x.test");
  });

  it("a gym B member sees only gym B classes", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore(MEMBER_B.id));

    const { props } = await callPage();

    expect(classIds(props)).toEqual(["class-b"]);
    expect(props.classes[0].coachEmail).toBe("coach-b@x.test");
  });

  it("never looks up bookings or waitlists for another gym's (or an unowned) class", async () => {
    await callPage();

    expect(bookingLookups().sort()).toEqual(["class-a-early", "class-a-late"]);
    expect(waitlistLookups().sort()).toEqual(["class-a-early", "class-a-late"]);
    expect(bookingLookups()).not.toContain("class-b");
    expect(bookingLookups()).not.toContain("class-orphan");
  });

  it("does not leak another gym's class identifiers or coach anywhere in the page props", async () => {
    const { props } = await callPage();
    const text = JSON.stringify(props);

    expect(text).not.toContain("class-b");
    expect(text).not.toContain("coach-b");
    expect(text).not.toContain("class-orphan");
  });

  it("fails closed for a class whose coach can't be resolved", async () => {
    h.findClasses.mockReturnValue([CLASS_ORPHAN]);

    const { props } = await callPage();

    expect(props.classes).toEqual([]);
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  });

  it("renders an empty class list (not an error) when the member's gym has no upcoming classes", async () => {
    h.findClasses.mockReturnValue([CLASS_B]);

    const { props } = await callPage();

    expect(props.classes).toEqual([]);
    expect(props.cancellationCutoffHours).toBe(12);
    expect(props.categories).toEqual([{ id: "strength", label: "Strength" }]);
  });

  it("ignores a client-supplied gymId (searchParams / props)", async () => {
    const { props } = await callPage({ searchParams: Promise.resolve({ gymId: "gym-b" }), gymId: "gym-b" });

    expect(classIds(props)).toEqual(["class-a-late", "class-a-early"]);
    expect(bookingLookups()).not.toContain("class-b");
  });

  it("keeps the member's own bookings sorted soonest-first and marks own same-gym booking/waitlist state", async () => {
    h.resolveBookingsForUser.mockReturnValue([
      { bookingId: "bk-late", classId: "class-a-late", isPast: false, date: isoDay(4), startTime: "18:00" },
      { bookingId: "bk-early", classId: "class-a-early", isPast: false, date: isoDay(2), startTime: "07:00" },
      { bookingId: "bk-old", classId: "class-a-past", isPast: true, date: isoDay(-3), startTime: "09:00" },
    ]);
    h.findBookingsByClassId.mockImplementation((id: string) =>
      id === "class-a-late" ? [{ id: "bk-late", classId: id, userId: MEMBER_A.id }] : []
    );
    h.findWaitlistEntriesByClassId.mockImplementation((id: string) =>
      id === "class-a-early"
        ? [{ id: "wl-1", classId: id, userId: MEMBER_A.id, offerState: "queued", offerExpiresAt: null }]
        : []
    );

    const { props } = await callPage();

    expect(props.upcomingBookings.map((b) => b.bookingId)).toEqual(["bk-early", "bk-late"]);
    expect(props.classes.find((c) => c.id === "class-a-late")?.bookedCount).toBe(1);
    expect(props.classes.find((c) => c.id === "class-a-early")).toMatchObject({
      isWaitlistedByMe: true,
      waitlistPosition: 1,
      waitlistEntryId: "wl-1",
    });
  });
});

describe("DashboardSchedulePage — session handling unchanged", () => {
  const isUnavailableState = (result: unknown) => JSON.stringify(result).includes("load profile data");

  it("shows the existing 'couldn't load profile data' state when unauthenticated, loading no class data", async () => {
    mockCookies.mockResolvedValue(NO_SESSION);

    const result = await callPage();

    expect(isUnavailableState(result)).toBe(true);
    expect(h.findClasses).not.toHaveBeenCalled();
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  });

  it("shows the same state for a session whose user was deleted", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore("ghost-user"));

    const result = await callPage();

    expect(isUnavailableState(result)).toBe(true);
    expect(h.findClasses).not.toHaveBeenCalled();
  });

  it("shows the same state for a user without a profile", async () => {
    h.findProfileByUserId.mockReturnValue(undefined);

    const result = await callPage();

    expect(isUnavailableState(result)).toBe(true);
    expect(h.findClasses).not.toHaveBeenCalled();
  });
});
