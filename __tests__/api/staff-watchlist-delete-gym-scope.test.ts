// Gym isolation for app/api/staff/attendance/watchlist/delete/route.ts.
// Ownership chain: watchlist entry -> entry.userId (the member) -> gym,
// compared with the acting staff member's gym. A cross-gym entry gets the same
// "This watchlist entry no longer exists." 404 as a missing one, before the
// delete. Auth uses the real signed-session mechanism; sameGymAsStaff and can()
// are deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findAttendanceWatchlist: vi.fn(),
  deleteWatchlistEntry: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const COACH_A = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const COACH_B = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const MEMBER_A = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const MEMBER_B = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const ENTRIES = [
  { id: "entry-a", userId: MEMBER_A.id, monthKey: "2026-01", missCount: 2, addedAt: "2026-01-01T00:00:00.000Z" },
  { id: "entry-b", userId: MEMBER_B.id, monthKey: "2026-01", missCount: 2, addedAt: "2026-01-01T00:00:00.000Z" },
  { id: "entry-orphan", userId: "member-gone", monthKey: "2026-01", missCount: 2, addedAt: "2026-01-01T00:00:00.000Z" },
];

const NOT_FOUND = { success: false, message: "This watchlist entry no longer exists." };

async function post(body: unknown, sessionUserId?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/staff/attendance/watchlist/delete/route");
  const req = new NextRequest("http://localhost/api/staff/attendance/watchlist/delete", {
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

const del = (id: string, sessionUserId: string = COACH_A.id) => post({ id }, sessionUserId);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [COACH_A, COACH_B, MEMBER_A, MEMBER_B].find((u) => u.id === id));
  h.findAttendanceWatchlist.mockReturnValue(ENTRIES);
});

describe("POST /api/staff/attendance/watchlist/delete — same-gym authorization", () => {
  it("deletes a same-gym entry with the existing response", async () => {
    const res = await del("entry-a");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Removed from the watchlist." });
    expect(h.deleteWatchlistEntry).toHaveBeenCalledWith("entry-a");
  });

  it("works within the second gym too", async () => {
    const res = await del("entry-b", COACH_B.id);

    expect(res.status).toBe(200);
    expect(h.deleteWatchlistEntry).toHaveBeenCalledWith("entry-b");
  });

  it("denies a cross-gym entry with the existing 404 — identical to a missing entry — and deletes nothing", async () => {
    const crossGym = await del("entry-b");
    const crossGymBody = await crossGym.json();
    const missing = await del("entry-missing");

    expect(crossGym.status).toBe(404);
    expect(crossGymBody).toEqual(NOT_FOUND);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(crossGymBody);
    expect(h.deleteWatchlistEntry).not.toHaveBeenCalled();
  });

  it("denies the reverse direction too (gym-B coach, gym-A entry)", async () => {
    const res = await del("entry-a", COACH_B.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(h.deleteWatchlistEntry).not.toHaveBeenCalled();
  });

  it("fails closed when the entry's member can't be resolved", async () => {
    const res = await del("entry-orphan");

    expect(res.status).toBe(404);
    expect(h.deleteWatchlistEntry).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId", async () => {
    const res = await post({ id: "entry-b", gymId: null }, COACH_A.id);

    expect(res.status).toBe(404);
    expect(h.deleteWatchlistEntry).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/attendance/watchlist/delete — authentication, capability, validation unchanged", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await post({ id: "entry-a" });

    expect(res.status).toBe(401);
    expect(h.deleteWatchlistEntry).not.toHaveBeenCalled();
  });

  it("rejects a member with 403, and checks capability before the gym (cross-gym member is 403, not 404)", async () => {
    const own = await del("entry-a", MEMBER_A.id);
    const crossGym = await del("entry-b", MEMBER_A.id);

    expect(own.status).toBe(403);
    expect((await own.json()).message).toBe("Only staff can manage the watchlist.");
    expect(crossGym.status).toBe(403);
    expect(h.deleteWatchlistEntry).not.toHaveBeenCalled();
  });

  it("preserves request validation", async () => {
    const badJson = await post(undefined, COACH_A.id, "{not json");
    expect(badJson.status).toBe(400);
    const noId = await post({}, COACH_A.id);
    expect(noId.status).toBe(400);
    expect((await noId.json()).message).toBe("A watchlist entry is required.");
    expect(h.deleteWatchlistEntry).not.toHaveBeenCalled();
  });
});
