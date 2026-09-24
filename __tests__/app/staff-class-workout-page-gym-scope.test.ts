// PR 1 — direct cross-gym target access: the web class-workout page
// (app/(staff)/staff/classes/[classId]/workout/page.tsx).
//
// Ownership: class -> class.coachUserId -> gym, compared with the acting staff
// member's gym (gymId: null is the primary gym, lib/gym-scope.ts). A cross-gym
// or unowned classId shows the existing "Class not found" state — identical to a
// missing class — and, the point of this file, nothing is loaded first: no
// attendee, profile, workout-session, template or exercise-library lookup. The
// classId comes from the URL; no client-supplied gym identifier can broaden it.
// (Per-attendee member-gym filtering on this page is a separate change, covered in
// staff-class-attendees-gym-scope.test.ts.)
//
// Auth uses the real signed-session mechanism; sameGymAsStaff / can are
// deliberately not mocked.
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
  findClassById: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findWorkoutSessionByUserAndClass: vi.fn(),
  findClassWorkoutByClassId: vi.fn(),
  findClassWorkoutTemplates: vi.fn(),
  findExercises: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/app/(staff)/staff/classes/[classId]/workout/ClassWorkoutView", () => ({ ClassWorkoutView: () => null }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const COACH_A = user("coach-a", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const USERS = [COACH_A, COACH_B, MEMBER_A, MEMBER_B];
const NAMES: Record<string, string> = { "member-a": "Alice Attendee", "member-b": "Bob SecretAttendee" };

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
const CLASSES = [cls("class-a", COACH_A.id), cls("class-b", COACH_B.id), cls("class-orphan", "coach-gone")];

const CHECKED_IN = "2030-01-01T00:00:00.000Z";
const booking = (id: string, classId: string, userId: string, attendedAt: string | null = CHECKED_IN) => ({ id, classId, userId, attendedAt });
const BOOKINGS: Record<string, ReturnType<typeof booking>[]> = {
  "class-a": [
    booking("bk-a", "class-a", MEMBER_A.id),
    booking("bk-ghost", "class-a", "member-gone"), // member no longer exists
  ],
  "class-b": [booking("bk-b", "class-b", MEMBER_B.id)],
};

const asStaff = (u: U) =>
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS) } : undefined),
  });

// React elements carry their component in `type` (circular for module objects);
// only props matter here.
const json = (v: unknown) => JSON.stringify(v, (k, x) => (k === "type" && typeof x !== "string" ? undefined : x));

const profileLookups = () => h.findProfileByUserId.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => USERS.find((u) => u.id === id));
  h.findClassById.mockImplementation((id: string) => CLASSES.find((c) => c.id === id));
  h.findBookingsByClassId.mockImplementation((id: string) => BOOKINGS[id] ?? []);
  h.findProfileByUserId.mockImplementation((id: string) => (NAMES[id] ? { fullName: NAMES[id] } : undefined));
  h.findWorkoutSessionByUserAndClass.mockReturnValue(undefined);
  h.findClassWorkoutByClassId.mockReturnValue(undefined);
  h.findClassWorkoutTemplates.mockReturnValue([]);
  h.findExercises.mockReturnValue([{ id: "ex-1" }]);
  asStaff(COACH_A);
});

describe("web class workout page — class gym check", () => {
  const page = async (classId: string, extra: Record<string, unknown> = {}) => {
    const { default: Page } = await import("@/app/(staff)/staff/classes/[classId]/workout/page");
    return (Page as (p: unknown) => Promise<{ props: Record<string, unknown> }>)({ params: Promise.resolve({ classId }), ...extra });
  };
  const notFound = (el: unknown) => json(el).includes("Class not found");
  const expectNothingLoaded = () => {
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
    expect(h.findProfileByUserId).not.toHaveBeenCalled();
    expect(h.findWorkoutSessionByUserAndClass).not.toHaveBeenCalled();
    expect(h.findClassWorkoutByClassId).not.toHaveBeenCalled();
    expect(h.findClassWorkoutTemplates).not.toHaveBeenCalled();
    expect(h.findExercises).not.toHaveBeenCalled();
  };

  it("shows a same-gym class and its checked-in attendees", async () => {
    const el = await page("class-a");
    const props = el.props as { classId: string; checkedIn: { userId: string; name: string }[] };

    expect(notFound(el)).toBe(false);
    expect(props.classId).toBe("class-a");
    expect(props.checkedIn.map((c) => c.userId)).toEqual([MEMBER_A.id, "member-gone"]);
    expect(props.checkedIn[0].name).toBe("Alice Attendee");
    expect(profileLookups()).toContain(MEMBER_A.id);
  });

  it("shows 'Class not found' for a cross-gym classId, identical to a missing class, loading nothing", async () => {
    const crossGym = await page("class-b");
    expect(notFound(crossGym)).toBe(true);
    expectNothingLoaded();
    expect(json(crossGym)).not.toMatch(/Class class-b|SecretAttendee|member-b/);

    const missing = await page("class-missing");
    expect(json(missing)).toEqual(json(crossGym));
  });

  it("fails closed for a class whose coach can't be resolved", async () => {
    const el = await page("class-orphan");

    expect(notFound(el)).toBe(true);
    expectNothingLoaded();
  });

  it("works within the second gym too, and denies gym A's class to gym B staff", async () => {
    asStaff(COACH_B);

    expect(notFound(await page("class-b"))).toBe(false);
    h.findBookingsByClassId.mockClear();
    expect(notFound(await page("class-a"))).toBe(true);
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  });

  it("ignores client-supplied gym identifiers (searchParams / props): a cross-gym class stays not found", async () => {
    const el = await page("class-b", { searchParams: Promise.resolve({ gymId: "gym-b" }), gymId: "gym-b" });

    expect(notFound(el)).toBe(true);
    expectNothingLoaded();
  });

  it("keeps redirects unchanged for a member / anonymous visitor, loading nothing", async () => {
    asStaff(MEMBER_A);
    expect(await page("class-a").then(() => null, (e: Error) => e.message)).toBe("REDIRECT:/dashboard");

    mockCookies.mockResolvedValue({ get: () => undefined });
    expect(await page("class-a").then(() => null, (e: Error) => e.message)).toBe("REDIRECT:/dashboard");

    expect(h.findClassById).not.toHaveBeenCalled();
    expectNothingLoaded();
  });
});
