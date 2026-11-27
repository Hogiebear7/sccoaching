// Self check-in route: the member comes from the session, the code must belong to the member's own gym, and only a booked class inside the window is checked in.
// Auth uses the real signed-session mechanism; the datastore is mocked like the other attendance tests.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gymCheckinCode, liveCheckinCode } from "@/lib/class-checkin";
import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findBookingsByUserId: vi.fn(),
  findClassById: vi.fn(),
  updateBookingAttendance: vi.fn(),
  findGymById: vi.fn(),
  findGymBySlug: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const SECRET = "checkin-test-secret";
const MEMBER_A = { id: "member-a", email: "a@x.test", role: "member" as const, gymId: null, archivedAt: null };
const MEMBER_B = { id: "member-b", email: "b@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const CLASS = { id: "c1", title: "Boxing", date: "2026-12-01", startTime: "18:00", durationMins: 45 };

async function scan(code: unknown, userId: string | null = MEMBER_A.id) {
  const { POST } = await import("@/app/api/mobile/checkin/route");
  const req = new NextRequest("http://localhost/api/mobile/checkin", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userId ? { Cookie: `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}` } : {}) },
    body: JSON.stringify({ code }),
  });
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T17:45:00Z"));
  h.findUserById.mockImplementation((id: string) => [MEMBER_A, MEMBER_B].find((u) => u.id === id));
  h.findClassById.mockImplementation((id: string) => (id === CLASS.id ? CLASS : undefined));
  h.findBookingsByUserId.mockReturnValue([{ id: "bk1", classId: "c1", userId: "member-a", attendedAt: null }]);
  // The primary gym (member A) uses the poster; gym B has not turned check-in on.
  h.findGymBySlug.mockReturnValue({ id: "primary-record", selfCheckin: "poster" });
  h.findGymById.mockReturnValue({ id: "gym-b" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/mobile/checkin", () => {
  it("checks the member in to their booked class", async () => {
    const res = await scan(gymCheckinCode(SECRET, null));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/checked in to Boxing/);
    expect(h.updateBookingAttendance).toHaveBeenCalledWith("bk1", true);
  });

  it("does nothing for a gym that has not turned check-in on", async () => {
    h.findGymBySlug.mockReturnValue({ id: "primary-record" });
    const res = await scan(gymCheckinCode(SECRET, null));
    expect(res.status).toBe(403);
    expect((await res.json()).data.state).toBe("off");
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("live mode takes the live code, not the poster; an old live code is refused", async () => {
    h.findGymBySlug.mockReturnValue({ id: "primary-record", selfCheckin: "live" });
    const now = Date.now();
    expect((await scan(liveCheckinCode(SECRET, null, now))).status).toBe(200);
    expect(h.updateBookingAttendance).toHaveBeenCalledTimes(1);

    h.updateBookingAttendance.mockClear();
    const poster = await scan(gymCheckinCode(SECRET, null));
    expect((await poster.json()).data.state).toBe("wrong_code");

    const old = await scan(liveCheckinCode(SECRET, null, now - 5 * 60_000));
    expect(old.status).toBe(409);
    expect((await old.json()).data.state).toBe("expired");
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("poster mode refuses a live code", async () => {
    const res = await scan(liveCheckinCode(SECRET, null, Date.now()));
    expect(res.status).toBe(409);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("needs a signed-in member", async () => {
    expect((await scan(gymCheckinCode(SECRET, null), null)).status).toBe(401);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("rejects a made-up code and another gym's code", async () => {
    expect((await scan("hello")).status).toBe(400);
    const other = await scan(gymCheckinCode(SECRET, "gym-b"));
    expect(other.status).toBe(403);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("does not check in twice", async () => {
    h.findBookingsByUserId.mockReturnValue([{ id: "bk1", classId: "c1", userId: "member-a", attendedAt: "2026-12-01T17:40:00Z" }]);
    const res = await scan(gymCheckinCode(SECRET, null));
    expect((await res.json()).data.state).toBe("already");
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });

  it("explains when it is too early or nothing is booked", async () => {
    vi.setSystemTime(new Date("2026-12-01T16:00:00Z"));
    const early = await scan(gymCheckinCode(SECRET, null));
    expect(early.status).toBe(409);
    expect((await early.json()).message).toMatch(/starts at 18:00/);

    h.findBookingsByUserId.mockReturnValue([]);
    const none = await scan(gymCheckinCode(SECRET, null));
    expect(none.status).toBe(409);
    expect(h.updateBookingAttendance).not.toHaveBeenCalled();
  });
});
