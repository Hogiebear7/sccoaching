import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindClassById,
  mockFindBookingsByUserId,
  mockFindBookingsByClassId,
  mockFindMembershipPackages,
  mockResolveEntitlement,
  mockFindSubscriptionByUserId,
  mockFindWaitlistEntryByClassAndUser,
  mockCreateWaitlistEntry,
  mockDeleteWaitlistEntry,
  mockFindWaitlistEntriesByClassId,
  mockSaveWaitlistEntry,
  mockIssueWaitlistOffer,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassById: vi.fn(),
  mockFindBookingsByUserId: vi.fn(),
  mockFindBookingsByClassId: vi.fn(),
  mockFindMembershipPackages: vi.fn(),
  mockResolveEntitlement: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindWaitlistEntryByClassAndUser: vi.fn(),
  mockCreateWaitlistEntry: vi.fn(),
  mockDeleteWaitlistEntry: vi.fn(),
  mockFindWaitlistEntriesByClassId: vi.fn(),
  mockSaveWaitlistEntry: vi.fn(),
  mockIssueWaitlistOffer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassById: mockFindClassById,
  findBookingsByUserId: mockFindBookingsByUserId,
  findBookingsByClassId: mockFindBookingsByClassId,
  findMembershipPackages: mockFindMembershipPackages,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findWaitlistEntryByClassAndUser: mockFindWaitlistEntryByClassAndUser,
  createWaitlistEntry: mockCreateWaitlistEntry,
  deleteWaitlistEntry: mockDeleteWaitlistEntry,
  findWaitlistEntriesByClassId: mockFindWaitlistEntriesByClassId,
  saveWaitlistEntry: mockSaveWaitlistEntry,
}));

vi.mock("@/lib/membership-entitlement", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/membership-entitlement")>()),
  resolveSubscriptionEntitlement: mockResolveEntitlement,
}));

vi.mock("@/lib/scheduling", () => ({
  issueWaitlistOffer: mockIssueWaitlistOffer,
}));

const MEMBER_USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

const FULL_CLASS = {
  id: "class-1",
  title: "Evening Strength",
  category: "strength" as const,
  coachUserId: "staff-1",
  date: "2026-12-25",
  startTime: "18:00",
  durationMins: 60,
  capacity: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callJoin(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/bookings/waitlist/join/route");
  const request = new NextRequest("http://localhost/api/bookings/waitlist/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  return POST(request);
}

async function callLeave(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/bookings/waitlist/leave/route");
  const request = new NextRequest("http://localhost/api/bookings/waitlist/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/bookings/waitlist/join", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindClassById.mockReset();
    mockFindBookingsByUserId.mockReset();
    mockFindBookingsByClassId.mockReset();
    mockFindMembershipPackages.mockReset();
    mockResolveEntitlement.mockReset();
    mockFindSubscriptionByUserId.mockReset();
    mockFindWaitlistEntryByClassAndUser.mockReset();
    mockCreateWaitlistEntry.mockReset();
    mockDeleteWaitlistEntry.mockReset();

    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindMembershipPackages.mockReturnValue([]);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    mockFindBookingsByUserId.mockReturnValue([]);
    mockFindWaitlistEntryByClassAndUser.mockReturnValue(undefined);
    mockFindWaitlistEntriesByClassId.mockReturnValue([]);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callJoin({ classId: "class-1" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the class does not exist", async () => {
    mockFindClassById.mockReturnValue(undefined);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callJoin({ classId: "missing" }, cookie);
    expect(res.status).toBe(404);
  });

  it("rejects joining a class that still has space", async () => {
    mockFindClassById.mockReturnValue(FULL_CLASS);
    mockFindBookingsByClassId.mockReturnValue([]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callJoin({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toMatch(/space/i);
    expect(mockCreateWaitlistEntry).not.toHaveBeenCalled();
  });

  it("rejects joining when already booked", async () => {
    mockFindClassById.mockReturnValue(FULL_CLASS);
    mockFindBookingsByClassId.mockReturnValue([{ id: "b1", classId: "class-1", userId: "other", attendedAt: null, createdAt: "now" }]);
    mockFindBookingsByUserId.mockReturnValue([{ id: "b2", classId: "class-1", userId: MEMBER_USER.id, attendedAt: null, createdAt: "now" }]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callJoin({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toMatch(/already booked/i);
  });

  it("rejects joining twice", async () => {
    mockFindClassById.mockReturnValue(FULL_CLASS);
    mockFindBookingsByClassId.mockReturnValue([{ id: "b1", classId: "class-1", userId: "other", attendedAt: null, createdAt: "now" }]);
    mockFindWaitlistEntryByClassAndUser.mockReturnValue({ id: "wl-1", classId: "class-1", userId: MEMBER_USER.id, createdAt: "now" });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callJoin({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toMatch(/already on the waitlist/i);
  });

  it("rejects joining when the member's plan doesn't cover the class category", async () => {
    mockFindClassById.mockReturnValue(FULL_CLASS);
    mockFindBookingsByClassId.mockReturnValue([{ id: "b1", classId: "class-1", userId: "other", attendedAt: null, createdAt: "now" }]);
    mockFindSubscriptionByUserId.mockReturnValue({ packageId: "pkg-mb", status: "active" });
    mockResolveEntitlement.mockReturnValue({ id: "pkg-mb", name: "Mother & Baby", allowedCategories: ["mother_and_baby"] });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callJoin({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toMatch(/doesn't include access/i);
    expect(mockCreateWaitlistEntry).not.toHaveBeenCalled();
  });

  it("joins the waitlist for a full, eligible class", async () => {
    mockFindClassById.mockReturnValue(FULL_CLASS);
    mockFindBookingsByClassId.mockReturnValue([{ id: "b1", classId: "class-1", userId: "other", attendedAt: null, createdAt: "now" }]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callJoin({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockCreateWaitlistEntry).toHaveBeenCalledTimes(1);
    expect(mockCreateWaitlistEntry.mock.calls[0][0].userId).toBe(MEMBER_USER.id);
  });

  it("rejects joining a waitlist that's at capacity with no live offers", async () => {
    mockFindClassById.mockReturnValue(FULL_CLASS);
    mockFindBookingsByClassId.mockReturnValue([{ id: "b1", classId: "class-1", userId: "other", attendedAt: null, createdAt: "now" }]);
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      { id: "wl-1", classId: "class-1", userId: "other-1", offerState: "queued", createdAt: "now" },
      { id: "wl-2", classId: "class-1", userId: "other-2", offerState: "queued", createdAt: "now" },
    ]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callJoin({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toMatch(/waitlist is full/i);
    expect(mockCreateWaitlistEntry).not.toHaveBeenCalled();
  });

  it("allows a bonus join when the full waitlist has a live offer out", async () => {
    mockFindClassById.mockReturnValue(FULL_CLASS);
    mockFindBookingsByClassId.mockReturnValue([{ id: "b1", classId: "class-1", userId: "other", attendedAt: null, createdAt: "now" }]);
    // The waitlist is nominally "full" (2 entries), but #1 is no longer
    // really queued — they have a live offer, so a 3rd person can join.
    mockFindWaitlistEntriesByClassId.mockReturnValue([
      { id: "wl-1", classId: "class-1", userId: "other-1", offerState: "offered", createdAt: "now" },
      { id: "wl-2", classId: "class-1", userId: "other-2", offerState: "queued", createdAt: "now" },
    ]);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callJoin({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockCreateWaitlistEntry).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/bookings/waitlist/leave", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindWaitlistEntryByClassAndUser.mockReset();
    mockDeleteWaitlistEntry.mockReset();
    mockSaveWaitlistEntry.mockReset();
    mockIssueWaitlistOffer.mockReset();
    mockFindUserById.mockReturnValue(MEMBER_USER);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callLeave({ classId: "class-1" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when not on the waitlist", async () => {
    mockFindWaitlistEntryByClassAndUser.mockReturnValue(undefined);
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callLeave({ classId: "class-1" }, cookie);
    expect(res.status).toBe(404);
    expect(mockSaveWaitlistEntry).not.toHaveBeenCalled();
  });

  it("removes the member's waitlist entry", async () => {
    mockFindWaitlistEntryByClassAndUser.mockReturnValue({ id: "wl-1", classId: "class-1", userId: MEMBER_USER.id, createdAt: "now" });
    const cookie = signSession({ userId: MEMBER_USER.id });

    const res = await callLeave({ classId: "class-1" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    // Entries are soft-removed (offerState "removed") for audit, not deleted.
    expect(mockSaveWaitlistEntry).toHaveBeenCalledTimes(1);
    expect(mockSaveWaitlistEntry.mock.calls[0][0]).toMatchObject({ id: "wl-1", offerState: "removed" });
  });
});
