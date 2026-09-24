// Cross-gym READ isolation for the mobile staff classes surfaces:
//   GET /api/mobile/staff/classes                    (lib/staff-classes-data.ts)
//   GET /api/mobile/staff/classes/[classId]/workout
// Ownership chain: class -> class.coachUserId -> gym, compared with the acting
// staff member's gym (gymId: null is the primary gym, lib/gym-scope.ts). The
// point of this file is not just that the response is filtered but that other
// gyms' attendee data is never LOADED: every booking/user/profile lookup is
// asserted to be made only for in-gym classes and members. Auth uses the real
// signed-session mechanism; sameGym / can() are deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findClasses: vi.fn(),
  findClassById: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findWorkoutSessionByUserAndClass: vi.fn(),
  findClassWorkoutByClassId: vi.fn(),
  findExercises: vi.fn(),
  ensureSeriesOccurrences: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  findUserById: h.findUserById,
  findClasses: h.findClasses,
  findClassById: h.findClassById,
  findBookingsByClassId: h.findBookingsByClassId,
  findProfileByUserId: h.findProfileByUserId,
  findWorkoutSessionByUserAndClass: h.findWorkoutSessionByUserAndClass,
  findClassWorkoutByClassId: h.findClassWorkoutByClassId,
  findExercises: h.findExercises,
}));
vi.mock("@/lib/class-series", () => ({ ensureSeriesOccurrences: h.ensureSeriesOccurrences }));

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const user = (id: string, role: string, gymId: string | null) => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });
const COACH_A = user("coach-a", "coach", null);
const COACH_A2 = user("coach-a2", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const USERS = [COACH_A, COACH_A2, COACH_B, MEMBER_A, MEMBER_B];

const NAMES: Record<string, string> = { "member-a": "Alice Attendee", "member-b": "Bob SecretAttendee" };

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
});
const CLASS_A_LATE = cls("class-a-late", COACH_A.id, isoDay(3), "18:00");
const CLASS_A_EARLY = cls("class-a-early", COACH_A2.id, isoDay(1), "07:00");
const CLASS_B = cls("class-b", COACH_B.id, isoDay(2), "09:00");
const CLASS_ORPHAN = cls("class-orphan", "coach-gone", isoDay(2), "10:00");
const CLASS_A_PAST = cls("class-a-past", COACH_A.id, isoDay(-2), "09:00");
const CLASS_A_FAR = cls("class-a-far", COACH_A.id, isoDay(40), "09:00");
const CLASSES = [CLASS_A_LATE, CLASS_B, CLASS_ORPHAN, CLASS_A_EARLY, CLASS_A_PAST, CLASS_A_FAR];

const CHECKED_IN = "2026-01-01T00:00:00.000Z";
const BOOKINGS: Record<string, { id: string; classId: string; userId: string; attendedAt: string | null }[]> = {
  "class-a-late": [{ id: "bk-a1", classId: "class-a-late", userId: MEMBER_A.id, attendedAt: CHECKED_IN }],
  "class-a-early": [],
  "class-b": [{ id: "bk-b1", classId: "class-b", userId: MEMBER_B.id, attendedAt: CHECKED_IN }],
  "class-orphan": [{ id: "bk-o1", classId: "class-orphan", userId: MEMBER_B.id, attendedAt: null }],
};

const sessionHeaders = (userId?: string): HeadersInit =>
  userId ? { Cookie: `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}` } : {};

async function listClasses(sessionUserId?: string, query = "") {
  const { GET } = await import("@/app/api/mobile/staff/classes/route");
  return GET(new NextRequest(`http://localhost/api/mobile/staff/classes${query}`, { headers: sessionHeaders(sessionUserId) }));
}

async function workout(classId: string, sessionUserId?: string) {
  const { GET } = await import("@/app/api/mobile/staff/classes/[classId]/workout/route");
  return GET(
    new NextRequest(`http://localhost/api/mobile/staff/classes/${classId}/workout`, { headers: sessionHeaders(sessionUserId) }),
    { params: Promise.resolve({ classId }) }
  );
}

const loadedBookingClassIds = () => h.findBookingsByClassId.mock.calls.map((c) => c[0]);
const loadedProfileUserIds = () => h.findProfileByUserId.mock.calls.map((c) => c[0]);
const loadedUserIds = () => h.findUserById.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => USERS.find((u) => u.id === id));
  h.findClasses.mockImplementation(() => CLASSES);
  h.findClassById.mockImplementation((id: string) => CLASSES.find((c) => c.id === id));
  h.findBookingsByClassId.mockImplementation((id: string) => BOOKINGS[id] ?? []);
  h.findProfileByUserId.mockImplementation((id: string) => (NAMES[id] ? { fullName: NAMES[id] } : undefined));
  h.findWorkoutSessionByUserAndClass.mockReturnValue(undefined);
  h.findClassWorkoutByClassId.mockReturnValue(undefined);
  h.findExercises.mockReturnValue([{ id: "ex-1" }]);
});

describe("GET /api/mobile/staff/classes — gym-scoped class list", () => {
  it("gym A staff see only gym A classes, sorted by date/time, with same-gym attendees", async () => {
    const res = await listClasses(COACH_A.id);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Existing window/sort behavior unchanged: past + >14-day classes excluded, ascending order.
    expect(body.data.map((c: { id: string }) => c.id)).toEqual(["class-a-early", "class-a-late"]);
    const late = body.data.find((c: { id: string }) => c.id === "class-a-late");
    expect(late.coachEmail).toBe("coach-a@x.test");
    expect(late.bookedCount).toBe(1);
    expect(late.roster).toEqual([
      { bookingId: "bk-a1", userId: MEMBER_A.id, email: MEMBER_A.email, fullName: "Alice Attendee", attendedAt: CHECKED_IN },
    ]);
  });

  it("gym B staff see only gym B classes", async () => {
    const res = await listClasses(COACH_B.id);
    const body = await res.json();

    expect(body.data.map((c: { id: string }) => c.id)).toEqual(["class-b"]);
    expect(body.data[0].roster.map((r: { email: string }) => r.email)).toEqual([MEMBER_B.email]);
  });

  it("never loads another gym's bookings, attendee users, or profiles (prevented, not filtered afterward)", async () => {
    const res = await listClasses(COACH_A.id);

    expect(loadedBookingClassIds().sort()).toEqual(["class-a-early", "class-a-late"]);
    expect(loadedBookingClassIds()).not.toContain("class-b");
    expect(loadedBookingClassIds()).not.toContain("class-orphan");
    expect(loadedProfileUserIds()).toEqual([MEMBER_A.id]);
    expect(loadedUserIds()).not.toContain(MEMBER_B.id);
    expect(JSON.stringify(await res.json())).not.toContain("SecretAttendee");
  });

  it("fails closed for a class whose coach can't be resolved: excluded, its attendees never loaded", async () => {
    const res = await listClasses(COACH_A.id);
    const ids = (await res.json()).data.map((c: { id: string }) => c.id);

    expect(ids).not.toContain("class-orphan");
    expect(loadedBookingClassIds()).not.toContain("class-orphan");
  });

  it("returns an empty list (not an error) when the staff member's gym has no classes", async () => {
    h.findClasses.mockReturnValue([CLASS_B]);

    const res = await listClasses(COACH_A.id);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
    expect(h.findProfileByUserId).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId query parameter", async () => {
    const res = await listClasses(COACH_A.id, "?gymId=gym-b");

    expect((await res.json()).data.map((c: { id: string }) => c.id)).toEqual(["class-a-early", "class-a-late"]);
    expect(loadedBookingClassIds()).not.toContain("class-b");
  });

  it("keeps authentication and the classes.manage capability unchanged", async () => {
    const anon = await listClasses();
    expect(anon.status).toBe(401);
    expect((await anon.json()).message).toBe("Not signed in.");

    const member = await listClasses(MEMBER_A.id);
    expect(member.status).toBe(403);
    expect((await member.json()).message).toBe("Staff access required.");

    expect(h.findClasses).not.toHaveBeenCalled();
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
    expect(h.findProfileByUserId).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/staff/classes/[classId]/workout — gym-scoped detail", () => {
  it("returns a same-gym class detail unchanged (checked-in attendees only)", async () => {
    const res = await workout("class-a-late", COACH_A.id);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.classId).toBe("class-a-late");
    expect(body.data.checkedIn).toEqual([expect.objectContaining({ userId: MEMBER_A.id, name: "Alice Attendee" })]);
    expect(body.data.existingWorkout).toBeNull();
    expect(JSON.stringify(body)).toContain("Alice Attendee");
    expect(body.data.libraryExercises).toEqual([{ id: "ex-1" }]);
  });

  it("denies a cross-gym class with the existing 404, identical to a missing class, loading no attendee data", async () => {
    const crossGym = await workout("class-b", COACH_A.id);
    const crossBody = await crossGym.json();

    expect(crossGym.status).toBe(404);
    expect(crossBody).toEqual({ success: false, message: "This class no longer exists." });
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
    expect(h.findProfileByUserId).not.toHaveBeenCalled();
    expect(h.findWorkoutSessionByUserAndClass).not.toHaveBeenCalled();
    expect(h.findClassWorkoutByClassId).not.toHaveBeenCalled();
    expect(h.findExercises).not.toHaveBeenCalled();
    expect(JSON.stringify(crossBody)).not.toContain("SecretAttendee");

    const missing = await workout("class-missing", COACH_A.id);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(crossBody);
  });

  it("denies the reverse direction (gym B staff, gym A class)", async () => {
    const res = await workout("class-a-late", COACH_B.id);

    expect(res.status).toBe(404);
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  });

  it("fails closed when the class's coach can't be resolved", async () => {
    const res = await workout("class-orphan", COACH_A.id);

    expect(res.status).toBe(404);
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  });

  it("keeps 401 / 403 unchanged, checking the capability before the gym (unauthorized cross-gym is 403)", async () => {
    expect((await workout("class-a-late")).status).toBe(401);
    expect((await workout("class-a-late", MEMBER_A.id)).status).toBe(403);
    expect((await workout("class-b", MEMBER_A.id)).status).toBe(403);
    expect(h.findClassById).not.toHaveBeenCalled();
    expect(h.findBookingsByClassId).not.toHaveBeenCalled();
  });
});
