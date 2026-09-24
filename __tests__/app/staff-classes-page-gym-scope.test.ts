// Cross-gym READ isolation for the web staff class list
// app/(staff)/staff/classes/page.tsx. Same harness as
// staff-users-page-gym-scope.test.ts: the page is a plain async Server
// Component, so calling it returns an UNrendered element whose props (handed to
// ClassesView) can be inspected without a DOM. The acting staff member comes
// from the real requireStaffPage() session flow; no client value can broaden
// it. Ownership chain: class -> class.coachUserId -> gym (gymId: null is the
// primary gym, lib/gym-scope.ts). The coach picker and the recurring-series
// list are scoped the same way. Beyond the props, data-access calls are
// asserted: no booking / waitlist / attendee-profile lookups for another gym's
// (or an unowned) class. sameGym and can() are deliberately not mocked.
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
  findClassSeries: vi.fn(),
  findClassCategories: vi.fn(),
  findDeletedCategoryLabels: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findWaitlistEntriesByClassId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findStaffUsers: vi.fn(),
  ensureSeriesOccurrences: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  findUserById: h.findUserById,
  findClasses: h.findClasses,
  findClassSeries: h.findClassSeries,
  findClassCategories: h.findClassCategories,
  findDeletedCategoryLabels: h.findDeletedCategoryLabels,
  findBookingsByClassId: h.findBookingsByClassId,
  findWaitlistEntriesByClassId: h.findWaitlistEntriesByClassId,
  findProfileByUserId: h.findProfileByUserId,
  findStaffUsers: h.findStaffUsers,
}));
vi.mock("@/lib/class-series", () => ({ ensureSeriesOccurrences: h.ensureSeriesOccurrences }));
vi.mock("@/app/(staff)/staff/classes/ClassesView", () => ({ ClassesView: () => null }));

type Person = { userId: string; email: string; fullName: string | null };
type ClassProp = {
  id: string;
  coachEmail: string;
  bookedCount: number;
  roster: (Person & { bookingId: string })[];
  waitlist: (Person & { position: number })[];
};
type Props = {
  classes: ClassProp[];
  series: { id: string }[];
  coaches: { userId: string; label: string }[];
  categories: unknown[];
  deletedLabels: Record<string, string>;
};

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null, archivedAt: string | null = null): U => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  archivedAt,
});

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const COACH_A = user("coach-a", "coach", null);
const COACH_A2 = user("coach-a2", "coach", null);
const ADMIN_A = user("admin-a", "admin", null);
const ARCHIVED_A = user("old-a", "coach", null, "2026-01-01T00:00:00.000Z");
const COACH_B = user("coach-b", "coach", "gym-b");
const ADMIN_B = user("admin-b", "admin", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_A2 = user("member-a2", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const STAFF = [COACH_A, COACH_A2, ADMIN_A, ARCHIVED_A, COACH_B, ADMIN_B];
const EVERYONE = [...STAFF, MEMBER_A, MEMBER_A2, MEMBER_B];
const NAMES: Record<string, string> = {
  "member-a": "Alice Attendee",
  "member-a2": "Amy Waitlister",
  "member-b": "Bob SecretAttendee",
  "coach-a": "Carl Coach",
  "coach-a2": "Cora Coach",
  "admin-a": "Adam Admin",
  "coach-b": "Ben SecretCoach",
  "admin-b": "Abby SecretAdmin",
};

const cls = (id: string, coachUserId: string, date: string, startTime: string) => ({
  id,
  title: `Class ${id}`,
  category: "strength",
  date,
  startTime,
  durationMins: 60,
  capacity: 10,
  coachUserId,
  seriesId: null,
});
// Deliberately not date-sorted: the page preserves findClasses() order (the
// view sorts), and this proves the scoping doesn't reorder or paginate.
const CLASS_A_LATE = cls("class-a-late", COACH_A.id, "2030-01-05", "18:00");
const CLASS_A_PAST = cls("class-a-past", COACH_A2.id, "2020-01-01", "09:00"); // past classes still listed (existing behavior)
const CLASS_B = cls("class-b", COACH_B.id, "2030-01-03", "09:00");
const CLASS_ORPHAN = cls("class-orphan", "coach-gone", "2030-01-04", "10:00");
const CLASS_A_EARLY = cls("class-a-early", COACH_A2.id, "2030-01-02", "07:00");
const CLASSES = [CLASS_A_LATE, CLASS_B, CLASS_ORPHAN, CLASS_A_PAST, CLASS_A_EARLY];

const CHECKED_IN = "2030-01-01T00:00:00.000Z";
const BOOKINGS: Record<string, { id: string; classId: string; userId: string; attendedAt: string | null }[]> = {
  "class-a-late": [{ id: "bk-a1", classId: "class-a-late", userId: MEMBER_A.id, attendedAt: CHECKED_IN }],
  "class-b": [{ id: "bk-b1", classId: "class-b", userId: MEMBER_B.id, attendedAt: CHECKED_IN }],
  "class-orphan": [{ id: "bk-o1", classId: "class-orphan", userId: MEMBER_B.id, attendedAt: null }],
};
const WAITLISTS: Record<string, { userId: string }[]> = {
  "class-a-late": [{ userId: MEMBER_A2.id }],
  "class-b": [{ userId: MEMBER_B.id }],
};

const SERIES_A = { id: "series-a", coachUserId: COACH_A.id, title: "A series", isActive: true };
const SERIES_B = { id: "series-b", coachUserId: COACH_B.id, title: "SecretGymB series", isActive: true };
const SERIES_ORPHAN = { id: "series-orphan", coachUserId: "coach-gone", title: "Orphan series", isActive: true };

function sessionCookieStore(userId: string) {
  const token = signSession({ userId }, MEMBER_SESSION_LIFETIME_MS);
  return { get: (name: string) => (name === "session" ? { value: token } : undefined) };
}
const NO_SESSION = { get: () => undefined };
const asStaff = (u: U) => mockCookies.mockResolvedValue(sessionCookieStore(u.id));

// The page takes no props; pass a client-supplied gymId anyway to prove it is ignored.
async function callPage(...args: unknown[]) {
  const { default: Page } = await import("@/app/(staff)/staff/classes/page");
  return (Page as (...a: unknown[]) => Promise<{ props: Props }>)(...args);
}

const classIds = (props: Props) => props.classes.map((c) => c.id);
const bookingLookups = () => h.findBookingsByClassId.mock.calls.map((c) => c[0]);
const waitlistLookups = () => h.findWaitlistEntriesByClassId.mock.calls.map((c) => c[0]);
const profileLookups = () => h.findProfileByUserId.mock.calls.map((c) => c[0]);
const userLookups = () => h.findUserById.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  h.findClasses.mockImplementation(() => CLASSES);
  h.findClassSeries.mockImplementation(() => [SERIES_A, SERIES_B, SERIES_ORPHAN]);
  h.findClassCategories.mockReturnValue([{ id: "strength", label: "Strength" }]);
  h.findDeletedCategoryLabels.mockReturnValue({ old: "Old label" });
  h.findBookingsByClassId.mockImplementation((id: string) => BOOKINGS[id] ?? []);
  h.findWaitlistEntriesByClassId.mockImplementation((id: string) => WAITLISTS[id] ?? []);
  h.findProfileByUserId.mockImplementation((id: string) => (NAMES[id] ? { fullName: NAMES[id] } : undefined));
  h.findStaffUsers.mockImplementation(() => STAFF);
  asStaff(COACH_A);
});

describe("StaffClassesPage — same-gym classes only", () => {
  it("gym A staff see only gym A classes, in the existing order, with same-gym roster and waitlist", async () => {
    const { props } = await callPage();

    // Existing behavior preserved: findClasses() order, past classes included, no pagination.
    expect(classIds(props)).toEqual(["class-a-late", "class-a-past", "class-a-early"]);
    const late = props.classes[0];
    expect(late.coachEmail).toBe("coach-a@x.test");
    expect(late.bookedCount).toBe(1);
    expect(late.roster).toEqual([
      { bookingId: "bk-a1", userId: MEMBER_A.id, email: MEMBER_A.email, fullName: "Alice Attendee", attendedAt: CHECKED_IN },
    ]);
    expect(late.waitlist).toEqual([
      { userId: MEMBER_A2.id, email: MEMBER_A2.email, fullName: "Amy Waitlister", position: 1 },
    ]);
    expect(props.classes[1]).toMatchObject({ bookedCount: 0, roster: [], waitlist: [] });
  });

  it("gym B staff see only gym B classes", async () => {
    asStaff(COACH_B);

    const { props } = await callPage();

    expect(classIds(props)).toEqual(["class-b"]);
    expect(props.classes[0].roster.map((r) => r.email)).toEqual([MEMBER_B.email]);
    expect(props.classes[0].waitlist.map((w) => w.email)).toEqual([MEMBER_B.email]);
  });

  it("never loads another gym's (or an unowned) class's bookings, waitlists, attendee users, or profiles", async () => {
    await callPage();

    expect(bookingLookups().sort()).toEqual(["class-a-early", "class-a-late", "class-a-past"]);
    expect(waitlistLookups().sort()).toEqual(["class-a-early", "class-a-late", "class-a-past"]);
    for (const other of ["class-b", "class-orphan"]) {
      expect(bookingLookups()).not.toContain(other);
      expect(waitlistLookups()).not.toContain(other);
    }
    expect(userLookups()).not.toContain(MEMBER_B.id);
    expect(profileLookups()).not.toContain(MEMBER_B.id);
    // Attendee/waitlist profiles are only for the gym A class's people.
    expect(profileLookups()).toEqual(expect.arrayContaining([MEMBER_A.id, MEMBER_A2.id]));
  });

  it("puts no other-gym class, coach, attendee, waitlist, email or name in the page props", async () => {
    const text = JSON.stringify((await callPage()).props);

    for (const leaked of ["class-b", "class-orphan", "coach-b", "admin-b", "member-b", "SecretAttendee", "SecretCoach", "SecretAdmin", "SecretGymB", "series-b"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("fails closed for a class whose coach can't be resolved: excluded, its attendees never loaded", async () => {
    h.findClasses.mockReturnValue([CLASS_ORPHAN]);

    const { props } = await callPage();

    expect(props.classes).toEqual([]);
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
    expect(h.findWaitlistEntriesByClassId).not.toHaveBeenCalled();
    expect(h.findProfileByUserId).not.toHaveBeenCalledWith(MEMBER_B.id);
  });

  it("renders an empty class list (not an error) when the staff member's gym has no classes", async () => {
    h.findClasses.mockReturnValue([CLASS_B]);

    const { props } = await callPage();

    expect(props.classes).toEqual([]);
    expect(props.categories).toEqual([{ id: "strength", label: "Strength" }]);
    expect(props.deletedLabels).toEqual({ old: "Old label" });
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId (searchParams / props)", async () => {
    const { props } = await callPage({ searchParams: Promise.resolve({ gymId: "gym-b" }), gymId: "gym-b" });

    expect(classIds(props)).toEqual(["class-a-late", "class-a-past", "class-a-early"]);
    expect(bookingLookups()).not.toContain("class-b");
  });

  it("still tops up recurring occurrences on each visit (unchanged global housekeeping)", async () => {
    await callPage();

    expect(h.ensureSeriesOccurrences).toHaveBeenCalledTimes(1);
  });
});

describe("StaffClassesPage — coach picker and series list are scoped too", () => {
  it("lists only gym A staff as coaches, sorted by label, including archived ones as before", async () => {
    const { props } = await callPage();

    expect(props.coaches).toEqual([
      { userId: ADMIN_A.id, label: "Adam Admin" },
      { userId: COACH_A.id, label: "Carl Coach" },
      { userId: COACH_A2.id, label: "Cora Coach" },
      { userId: ARCHIVED_A.id, label: ARCHIVED_A.email }, // no profile -> email label (existing behavior)
    ].sort((a, b) => a.label.localeCompare(b.label)));
  });

  it("lists only gym B staff to a gym B admin", async () => {
    asStaff(ADMIN_B);

    const { props } = await callPage();

    expect(props.coaches.map((c) => c.userId).sort()).toEqual([ADMIN_B.id, COACH_B.id]);
  });

  it("lists only series whose coach is in the staff member's gym; an unowned series fails closed", async () => {
    expect((await callPage()).props.series.map((s) => s.id)).toEqual(["series-a"]);

    asStaff(COACH_B);
    expect((await callPage()).props.series.map((s) => s.id)).toEqual(["series-b"]);
  });
});

describe("StaffClassesPage — capability and redirect behavior unchanged", () => {
  const redirectedTo = async () => callPage().then(() => null, (e: Error) => e.message);

  it("redirects an unauthenticated visitor to /dashboard, loading no class data", async () => {
    mockCookies.mockResolvedValue(NO_SESSION);

    expect(await redirectedTo()).toBe("REDIRECT:/dashboard");
    expect(h.findClasses).not.toHaveBeenCalled();
    expect(h.ensureSeriesOccurrences).not.toHaveBeenCalled();
  });

  it("redirects a member (no staff access) to /dashboard, loading no class data", async () => {
    asStaff(MEMBER_A);

    expect(await redirectedTo()).toBe("REDIRECT:/dashboard");
    expect(h.findClasses).not.toHaveBeenCalled();
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  });

  it("redirects an archived staff member to /dashboard", async () => {
    asStaff(ARCHIVED_A);

    expect(await redirectedTo()).toBe("REDIRECT:/dashboard");
    expect(h.findClasses).not.toHaveBeenCalled();
  });

  it("redirects a session whose user was deleted to /dashboard", async () => {
    mockCookies.mockResolvedValue(sessionCookieStore("ghost-user"));

    expect(await redirectedTo()).toBe("REDIRECT:/dashboard");
    expect(h.findClasses).not.toHaveBeenCalled();
  });
});
