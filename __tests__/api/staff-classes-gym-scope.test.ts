// Route-level cross-gym authorization tests for the 4 app/api/staff/classes/*
// routes, which previously had a capability check but no gym-ownership
// check (see docs/tenant-boundary-audit-2026-09.md and the follow-up plan
// that closed this gap). Ownership is derived via ClassRecord/
// ClassSeriesRecord.coachUserId -> sameGymAsStaff(), the same one-hop
// pattern already used for training programs.
//
// Conventions reused verbatim from __tests__/api/staff-members-gym-scope.test.ts
// and __tests__/api/mobile-staff-gym-scope.test.ts: real signSession() + a
// session cookie (not a mocked verifyRequestSession), and sameGymAsStaff()/
// can() left un-mocked since exercising the real authorization logic is the
// point of this file.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findClassById: vi.fn(),
  findClassCategories: vi.fn(),
  saveClass: vi.fn(),
  findClassSeriesById: vi.fn(),
  saveClassSeries: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findAllWaitlistEntries: vi.fn(),
  deleteBooking: vi.fn(),
  deleteClass: vi.fn(),
  deleteWaitlistEntry: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  saveSubscription: vi.fn(),
  createNotification: vi.fn(),
  findProfileByUserId: vi.fn(),
  findWorkoutSessionByUserAndClass: vi.fn(),
  saveClassWorkout: vi.fn(),
  saveWorkoutSession: vi.fn(),
  findClassesBySeriesId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// These are DB/network-touching side-effect helpers, mocked directly so the
// same-gym control cases can reach a real 200 without needing to satisfy
// their own internal logic — unrelated to gym-scope. classStartMs (pure
// date math), the image-upload validators, and parseExerciseEntries (pure
// parsing) are deliberately NOT mocked; real fixtures satisfy them cheaply.
const { mockGenerateOccurrences } = vi.hoisted(() => ({ mockGenerateOccurrences: vi.fn() }));
vi.mock("@/lib/class-series", () => ({ generateOccurrencesForSeries: mockGenerateOccurrences }));

const { mockIssueWaitlistOffer } = vi.hoisted(() => ({ mockIssueWaitlistOffer: vi.fn() }));
vi.mock("@/lib/scheduling", () => ({ issueWaitlistOffer: mockIssueWaitlistOffer }));

const { mockSyncClassWorkoutToAllBooked } = vi.hoisted(() => ({ mockSyncClassWorkoutToAllBooked: vi.fn() }));
vi.mock("@/lib/class-workout-sync", () => ({ syncClassWorkoutToAllBooked: mockSyncClassWorkoutToAllBooked }));

const { mockReversePassConsumption } = vi.hoisted(() => ({ mockReversePassConsumption: vi.fn() }));
vi.mock("@/lib/payments", () => ({ reversePassConsumption: mockReversePassConsumption }));

const { mockSendPush } = vi.hoisted(() => ({ mockSendPush: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPush: mockSendPush }));

// gymId: null is the established primary-gym convention — GYM_A represents
// "the primary gym" via that convention rather than a literal id.
const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin_manager" as const, gymId: null, archivedAt: null };
const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_B_COACH = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const MEMBER_USER = { id: "member-1", email: "member@x.test", role: "member" as const, gymId: null, archivedAt: null };

const auth = signSession({ userId: GYM_A_STAFF.id });

function usersById(...users: { id: string }[]) {
  const map = new Map(users.map((u) => [u.id, u]));
  return (id: string) => map.get(id);
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function call(
  routeFile: string,
  { body, params, sessionUserId = GYM_A_STAFF.id }: { body?: unknown; params?: Record<string, string>; sessionUserId?: string } = {}
) {
  const mod = routeFile === "" ? await import("@/app/api/staff/classes/route") : await import(`@/app/api/staff/classes/${routeFile}/route`);
  const token = signSession({ userId: sessionUserId });
  const req = new NextRequest(`http://localhost/api/staff/classes/${routeFile}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return params ? mod.POST(req, { params: Promise.resolve(params) }) : mod.POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_COACH, GYM_B_COACH, MEMBER_USER));
  h.findClassCategories.mockReturnValue([{ slug: "general", name: "General" }]);
});

describe("POST /api/staff/classes (edit path)", () => {
  const editBody = {
    id: "class-1",
    title: "Updated Class",
    category: "general",
    date: futureDate(7),
    startTime: "10:00",
    durationMins: 60,
    capacity: 10,
  };

  it("denies editing a cross-gym class", async () => {
    h.findClassById.mockReturnValue({ id: "class-1", coachUserId: GYM_B_COACH.id, date: futureDate(7), capacity: 10 });
    const res = await call("", { body: editBody });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "This class no longer exists." });
    expect(h.saveClass).not.toHaveBeenCalled();
  });

  it("edits a same-gym class (control)", async () => {
    h.findClassById.mockReturnValue({ id: "class-1", coachUserId: GYM_A_COACH.id, date: futureDate(7), capacity: 10 });
    const res = await call("", { body: editBody });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: "Class updated." });
    expect(h.saveClass).toHaveBeenCalled();
  });

  it("denies an unauthenticated request", async () => {
    const mod = await import("@/app/api/staff/classes/route");
    const req = new NextRequest("http://localhost/api/staff/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editBody),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(401);
  });

  it("denies a member without classes.manage", async () => {
    const res = await call("", { body: editBody, sessionUserId: MEMBER_USER.id });
    expect(res.status).toBe(403);
    expect(h.saveClass).not.toHaveBeenCalled();
  });

  it("rejects a malformed body (missing title) regardless of gym", async () => {
    const res = await call("", { body: { ...editBody, title: "" } });
    expect(res.status).toBe(400);
  });

  // findClassById returning undefined for a stray id falls through to the
  // create path rather than 404ing — pre-existing route behavior, unrelated
  // to this gym-scope slice, so "missing target" isn't tested here; it's
  // covered cleanly by the other three routes below.
});

describe("POST /api/staff/classes/delete", () => {
  it("denies deleting a cross-gym class", async () => {
    h.findClassById.mockReturnValue({ id: "class-1", coachUserId: GYM_B_COACH.id, date: futureDate(7), startTime: "10:00" });
    const res = await call("delete", { body: { id: "class-1" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "This class no longer exists." });
    expect(h.deleteClass).not.toHaveBeenCalled();
  });

  it("deletes a same-gym class (control)", async () => {
    h.findClassById.mockReturnValue({ id: "class-1", coachUserId: GYM_A_COACH.id, date: futureDate(7), startTime: "10:00", title: "Class" });
    h.findBookingsByClassId.mockReturnValue([]);
    h.findAllWaitlistEntries.mockReturnValue([]);
    const res = await call("delete", { body: { id: "class-1" } });
    expect(res.status).toBe(200);
    expect(h.deleteClass).toHaveBeenCalledWith("class-1");
  });

  it("denies an unauthenticated request", async () => {
    const mod = await import("@/app/api/staff/classes/delete/route");
    const req = new NextRequest("http://localhost/api/staff/classes/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "class-1" }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(401);
  });

  it("denies a member without classes.manage", async () => {
    const res = await call("delete", { body: { id: "class-1" }, sessionUserId: MEMBER_USER.id });
    expect(res.status).toBe(403);
    expect(h.deleteClass).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing class", async () => {
    h.findClassById.mockReturnValue(undefined);
    const res = await call("delete", { body: { id: "does-not-exist" } });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed body (missing id)", async () => {
    const res = await call("delete", { body: {} });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/staff/classes/[classId]/workout", () => {
  const body = { exercises: [{ name: "Back Squat" }] };

  it("denies recording a workout for a cross-gym class", async () => {
    h.findClassById.mockReturnValue({ id: "class-1", coachUserId: GYM_B_COACH.id });
    const res = await call("[classId]/workout", { params: { classId: "class-1" }, body });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "This class no longer exists." });
    expect(h.saveClassWorkout).not.toHaveBeenCalled();
  });

  it("records a workout for a same-gym class (control)", async () => {
    h.findClassById.mockReturnValue({ id: "class-1", coachUserId: GYM_A_COACH.id, date: futureDate(1), title: "Class", durationMins: 45 });
    h.findBookingsByClassId.mockReturnValue([]);
    mockSyncClassWorkoutToAllBooked.mockReturnValue(0);
    const res = await call("[classId]/workout", { params: { classId: "class-1" }, body });
    expect(res.status).toBe(200);
    expect(h.saveClassWorkout).toHaveBeenCalled();
  });

  it("denies an unauthenticated request", async () => {
    const mod = await import("@/app/api/staff/classes/[classId]/workout/route");
    const req = new NextRequest("http://localhost/api/staff/classes/class-1/workout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await mod.POST(req, { params: Promise.resolve({ classId: "class-1" }) });
    expect(res.status).toBe(401);
  });

  it("denies a member without classes.manage", async () => {
    const res = await call("[classId]/workout", { params: { classId: "class-1" }, body, sessionUserId: MEMBER_USER.id });
    expect(res.status).toBe(403);
    expect(h.saveClassWorkout).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing class", async () => {
    h.findClassById.mockReturnValue(undefined);
    const res = await call("[classId]/workout", { params: { classId: "does-not-exist" }, body });
    expect(res.status).toBe(404);
  });

  it("rejects an empty exercises list for a same-gym class", async () => {
    h.findClassById.mockReturnValue({ id: "class-1", coachUserId: GYM_A_COACH.id });
    const res = await call("[classId]/workout", { params: { classId: "class-1" }, body: { exercises: [] } });
    expect(res.status).toBe(400);
    expect(h.saveClassWorkout).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/classes/series/stop", () => {
  it("denies stopping a cross-gym series", async () => {
    h.findClassSeriesById.mockReturnValue({ id: "series-1", coachUserId: GYM_B_COACH.id, isActive: true, title: "Series" });
    const res = await call("series/stop", { body: { id: "series-1" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "This repeating class no longer exists." });
    expect(h.saveClassSeries).not.toHaveBeenCalled();
  });

  it("stops a same-gym series (control)", async () => {
    h.findClassSeriesById.mockReturnValue({ id: "series-1", coachUserId: GYM_A_COACH.id, isActive: true, title: "Series" });
    h.findClassesBySeriesId.mockReturnValue([]);
    const res = await call("series/stop", { body: { id: "series-1" } });
    expect(res.status).toBe(200);
    expect(h.saveClassSeries).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it("denies an unauthenticated request", async () => {
    const mod = await import("@/app/api/staff/classes/series/stop/route");
    const req = new NextRequest("http://localhost/api/staff/classes/series/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "series-1" }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(401);
  });

  it("denies a member without classes.manage", async () => {
    const res = await call("series/stop", { body: { id: "series-1" }, sessionUserId: MEMBER_USER.id });
    expect(res.status).toBe(403);
    expect(h.saveClassSeries).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing series", async () => {
    h.findClassSeriesById.mockReturnValue(undefined);
    const res = await call("series/stop", { body: { id: "does-not-exist" } });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed body (missing id)", async () => {
    const res = await call("series/stop", { body: {} });
    expect(res.status).toBe(400);
  });

  it("returns 409 for an already-stopped same-gym series", async () => {
    h.findClassSeriesById.mockReturnValue({ id: "series-1", coachUserId: GYM_A_COACH.id, isActive: false, title: "Series" });
    const res = await call("series/stop", { body: { id: "series-1" } });
    expect(res.status).toBe(409);
    expect(h.saveClassSeries).not.toHaveBeenCalled();
  });
});
