// Tenant-boundary check for the staff class surfaces:
//
// ATTENDEE / WAITLIST members on an IN-gym class are gym-checked
//    individually (member.gymId — trusted, on the user record — not inferred
//    from the class or coach). A legacy cross-gym member attached to an in-gym
//    class is left out of rosters, waitlists and check-in lists, and their
//    profile / workout session is never read. A booking whose member no longer
//    exists keeps the existing "Unknown member" placeholder (nothing to leak).
//    Covered on: mobile class list, mobile class workout detail, web class list,
//    web class workout page.
// (The class -> coach -> gym gate on the web class-workout page, and its
// "Class not found" behavior, are covered separately in
// staff-class-workout-page-gym-scope.test.ts.)
//
// Auth uses the real signed-session mechanism; sameGym / sameGymAsStaff / can
// are deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockCookies, mockRedirect } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findClasses: vi.fn(),
  findClassById: vi.fn(),
  findClassSeries: vi.fn(),
  findClassCategories: vi.fn(),
  findDeletedCategoryLabels: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findWaitlistEntriesByClassId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findStaffUsers: vi.fn(),
  findWorkoutSessionByUserAndClass: vi.fn(),
  findClassWorkoutByClassId: vi.fn(),
  findClassWorkoutTemplates: vi.fn(),
  findExercises: vi.fn(),
  ensureSeriesOccurrences: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/class-series", () => ({ ensureSeriesOccurrences: h.ensureSeriesOccurrences }));
vi.mock("@/app/(staff)/staff/classes/ClassesView", () => ({ ClassesView: () => null }));
vi.mock("@/app/(staff)/staff/classes/[classId]/workout/ClassWorkoutView", () => ({ ClassWorkoutView: () => null }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const COACH_A = user("coach-a", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_A2 = user("member-a2", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b"); // legacy cross-gym attendee
const USERS = [COACH_A, COACH_B, MEMBER_A, MEMBER_A2, MEMBER_B];
const NAMES: Record<string, string> = { "member-a": "Alice Attendee", "member-a2": "Amy Two", "member-b": "Bob SecretAttendee" };

const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const cls = (id: string, coachUserId: string) => ({
  id,
  title: `Class ${id}`,
  category: "strength",
  date: future,
  startTime: "18:00",
  durationMins: 60,
  capacity: 10,
  coachUserId,
  seriesId: null,
});
const CLASS_A = cls("class-a", COACH_A.id);
const CLASS_B = cls("class-b", COACH_B.id);
const CLASS_ORPHAN = cls("class-orphan", "coach-gone");
const CLASSES = [CLASS_A, CLASS_B, CLASS_ORPHAN];

const CHECKED_IN = "2030-01-01T00:00:00.000Z";
const booking = (id: string, classId: string, userId: string, attendedAt: string | null = CHECKED_IN) => ({ id, classId, userId, attendedAt });
const BOOKINGS: Record<string, ReturnType<typeof booking>[]> = {
  "class-a": [
    booking("bk-a", "class-a", MEMBER_A.id),
    booking("bk-legacy-b", "class-a", MEMBER_B.id), // cross-gym member on an in-gym class
    booking("bk-ghost", "class-a", "member-gone"), // member no longer exists
  ],
  "class-b": [booking("bk-b", "class-b", MEMBER_B.id)],
};
const WAITLISTS: Record<string, { userId: string }[]> = {
  "class-a": [{ userId: MEMBER_B.id }, { userId: MEMBER_A2.id }], // queue: legacy cross-gym first, real member second
};

const sessionFor = (u: U) => ({ Cookie: `session=${signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS)}` });
const asStaff = (u: U) =>
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS) } : undefined),
  });

// React elements carry their component in `type` (circular for module objects);
// only props matter here.
const json = (v: unknown) => JSON.stringify(v, (k, x) => (k === "type" && typeof x !== "string" ? undefined : x));

const profileLookups = () => h.findProfileByUserId.mock.calls.map((c) => c[0]);
const sessionLookups = () => h.findWorkoutSessionByUserAndClass.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => USERS.find((u) => u.id === id));
  h.findClasses.mockImplementation(() => CLASSES);
  h.findClassById.mockImplementation((id: string) => CLASSES.find((c) => c.id === id));
  h.findClassSeries.mockReturnValue([]);
  h.findClassCategories.mockReturnValue([]);
  h.findDeletedCategoryLabels.mockReturnValue({});
  h.findBookingsByClassId.mockImplementation((id: string) => BOOKINGS[id] ?? []);
  h.findWaitlistEntriesByClassId.mockImplementation((id: string) => WAITLISTS[id] ?? []);
  h.findProfileByUserId.mockImplementation((id: string) => (NAMES[id] ? { fullName: NAMES[id] } : undefined));
  h.findStaffUsers.mockReturnValue([COACH_A, COACH_B]);
  h.findWorkoutSessionByUserAndClass.mockReturnValue(undefined);
  h.findClassWorkoutByClassId.mockReturnValue(undefined);
  h.findClassWorkoutTemplates.mockReturnValue([]);
  h.findExercises.mockReturnValue([{ id: "ex-1" }]);
  asStaff(COACH_A);
});

describe("mobile class list — attendees are gym-checked individually", () => {
  it("leaves a legacy cross-gym attendee out of the roster, never reading their profile; bookedCount stays real", async () => {
    const { GET } = await import("@/app/api/mobile/staff/classes/route");

    const res = await GET(new NextRequest("http://localhost/api/mobile/staff/classes", { headers: sessionFor(COACH_A) }));
    const body = await res.json();
    const classA = body.data.find((c: { id: string }) => c.id === "class-a");

    expect(classA.roster.map((r: { bookingId: string }) => r.bookingId)).toEqual(["bk-a", "bk-ghost"]);
    expect(classA.roster[1]).toMatchObject({ email: "Unknown member", fullName: null });
    expect(classA.bookedCount).toBe(3);
    expect(profileLookups()).not.toContain(MEMBER_B.id);
    expect(JSON.stringify(body)).not.toMatch(/SecretAttendee|member-b/);
  });
});

describe("mobile class workout detail — check-in list is gym-checked", () => {
  const detail = async (classId: string, u: U = COACH_A) => {
    const { GET } = await import("@/app/api/mobile/staff/classes/[classId]/workout/route");
    return GET(new NextRequest(`http://localhost/api/mobile/staff/classes/${classId}/workout`, { headers: sessionFor(u) }), {
      params: Promise.resolve({ classId }),
    });
  };

  it("omits the cross-gym attendee and never reads their profile or workout session", async () => {
    const body = await (await detail("class-a")).json();

    expect(body.data.checkedIn.map((c: { userId: string }) => c.userId)).toEqual([MEMBER_A.id, "member-gone"]);
    expect(body.data.checkedIn[1].name).toBe("Unknown member");
    expect(profileLookups()).not.toContain(MEMBER_B.id);
    expect(sessionLookups()).not.toContain(MEMBER_B.id);
    expect(JSON.stringify(body)).not.toContain("SecretAttendee");
  });
});

describe("web staff class list — roster and waitlist are gym-checked", () => {
  const page = async () => {
    const { default: Page } = await import("@/app/(staff)/staff/classes/page");
    return (Page as () => Promise<{
      props: { classes: { id: string; bookedCount: number; roster: { bookingId: string; email: string }[]; waitlist: { userId: string; position: number }[] }[] };
    }>)();
  };

  it("leaves the legacy cross-gym attendee and waitlisted member out, never reading their profile; positions keep their queue number", async () => {
    const { props } = await page();
    const classA = props.classes.find((c) => c.id === "class-a")!;

    expect(classA.roster.map((r) => r.bookingId)).toEqual(["bk-a", "bk-ghost"]);
    expect(classA.roster[1].email).toBe("Unknown member");
    expect(classA.bookedCount).toBe(3);
    expect(classA.waitlist).toEqual([expect.objectContaining({ userId: MEMBER_A2.id, position: 2 })]);
    expect(profileLookups()).not.toContain(MEMBER_B.id);
    expect(JSON.stringify(props)).not.toMatch(/SecretAttendee|member-b/);
  });

  it("still shows a gym B class with its own gym B attendee to gym B staff", async () => {
    asStaff(COACH_B);

    const { props } = await page();

    expect(props.classes.map((c) => c.id)).toEqual(["class-b"]);
    expect(props.classes[0].roster.map((r) => r.bookingId)).toEqual(["bk-b"]);
  });
});

describe("web class workout page — check-in list is gym-checked", () => {
  const page = async (classId: string) => {
    const { default: Page } = await import("@/app/(staff)/staff/classes/[classId]/workout/page");
    return (Page as (p: unknown) => Promise<{ props: Record<string, unknown> }>)({ params: Promise.resolve({ classId }) });
  };

  it("leaves a legacy cross-gym attendee out of a same-gym class's check-in list, never reading their profile or workout session", async () => {
    const el = await page("class-a");
    const props = el.props as { classId: string; checkedIn: { userId: string; name: string }[] };

    expect(json(el).includes("Class not found")).toBe(false);
    expect(props.classId).toBe("class-a");
    expect(props.checkedIn.map((c) => c.userId)).toEqual([MEMBER_A.id, "member-gone"]);
    expect(props.checkedIn[0].name).toBe("Alice Attendee");
    expect(profileLookups()).not.toContain(MEMBER_B.id);
    expect(sessionLookups()).not.toContain(MEMBER_B.id);
    expect(json(el)).not.toContain("SecretAttendee");
  });
});
