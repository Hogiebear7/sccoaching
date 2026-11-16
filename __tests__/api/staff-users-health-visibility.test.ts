import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockFindUserById, mockSetHide } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockSetHide: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findUserByEmail: vi.fn(),
  createUserWithRole: vi.fn(),
  updateUserRole: vi.fn(),
  findStaffUsers: vi.fn(() => []),
  setUserHideMemberHealth: mockSetHide,
}));

const MANAGER = { id: "mgr-1", email: "mgr@club.com", role: "admin_manager" as const, archivedAt: null };
const COACH = { id: "coach-1", email: "coach@club.com", role: "coach" as const, archivedAt: null };
const MEMBER = { id: "mem-1", email: "m@club.com", role: "member" as const, archivedAt: null };

async function call(body: unknown, userId: string) {
  const { POST } = await import("@/app/api/staff/staff-users/health-visibility/route");
  const req = new NextRequest("http://localhost/api/staff/staff-users/health-visibility", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}` },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/staff/staff-users/health-visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockImplementation((id: string) => [MANAGER, COACH, MEMBER].find((u) => u.id === id));
  });

  it("lets an admin manager hide and show health details for a coach", async () => {
    const hide = await call({ id: "coach-1", hidden: true }, "mgr-1");
    expect(hide.status).toBe(200);
    expect(mockSetHide).toHaveBeenCalledWith("coach-1", true);
    const show = await call({ id: "coach-1", hidden: false }, "mgr-1");
    expect(show.status).toBe(200);
    expect(mockSetHide).toHaveBeenLastCalledWith("coach-1", false);
  });

  it("refuses a coach (only an admin manager manages staff)", async () => {
    const res = await call({ id: "coach-1", hidden: true }, "coach-1");
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(mockSetHide).not.toHaveBeenCalled();
  });

  it("refuses a non-boolean value, a missing user and a member target", async () => {
    expect((await call({ id: "coach-1", hidden: "yes" }, "mgr-1")).status).toBe(400);
    expect((await call({ id: "nobody", hidden: true }, "mgr-1")).status).toBe(404);
    expect((await call({ id: "mem-1", hidden: true }, "mgr-1")).status).toBe(400);
    expect(mockSetHide).not.toHaveBeenCalled();
  });
});
