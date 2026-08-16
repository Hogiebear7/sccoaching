import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockFindProfileByUserId, mockSaveProfile } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
  mockSaveProfile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findProfileByUserId: mockFindProfileByUserId,
  saveProfile: mockSaveProfile,
}));

const USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };
const PROFILE = {
  userId: "user-1",
  fullName: "Alex Rivera",
  email: "athlete@example.com",
  restTimerSeconds: 90,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callRestTimer(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/profile/rest-timer/route");
  const request = new NextRequest("http://localhost/api/profile/rest-timer", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/profile/rest-timer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(USER);
    mockFindProfileByUserId.mockReturnValue(PROFILE);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await callRestTimer({ restTimerSeconds: 120 });
    expect(res.status).toBe(401);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("saves a valid duration", async () => {
    const res = await callRestTimer({ restTimerSeconds: 120 }, signSession({ userId: USER.id }));
    expect(res.status).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0]).toMatchObject({ restTimerSeconds: 120 });
  });

  it("rejects non-integers, out-of-range values, and missing input", async () => {
    const cookie = signSession({ userId: USER.id });

    for (const restTimerSeconds of [14, 601, 45.5, "90", null, undefined]) {
      const res = await callRestTimer({ restTimerSeconds }, cookie);
      expect(res.status).toBe(400);
    }
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("returns 404 when the profile doesn't exist", async () => {
    mockFindProfileByUserId.mockReturnValue(undefined);
    const res = await callRestTimer({ restTimerSeconds: 90 }, signSession({ userId: USER.id }));
    expect(res.status).toBe(404);
  });
});
