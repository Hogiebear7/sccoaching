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

const EXISTING_PROFILE = {
  userId: "user-1",
  fullName: "Old Name",
  email: "athlete@example.com",
  phone: "555-0000",
  gender: "Male",
  primaryGoal: "General Health",
  sportPlayed: null,
  currentWeightKg: 80,
  additionalInfo: null,
  cycleTrackingEligible: false,
  cycleTrackingEnabled: false,
  onboardingCompleted: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callProfileUpdate(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/profile/update/route");
  const request = new NextRequest("http://localhost/api/profile/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/profile/update", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindProfileByUserId.mockReset();
    mockSaveProfile.mockReset();
    mockFindUserById.mockReturnValue({ id: "user-1", email: "athlete@example.com" });
    mockFindProfileByUserId.mockReturnValue(EXISTING_PROFILE);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callProfileUpdate({ fullName: "New Name" });

    expect(res.status).toBe(401);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("updates editable fields while preserving immutable ones", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callProfileUpdate(
      {
        fullName: "New Name",
        phone: "555-1111",
        gender: "Male",
        primaryGoal: "Build Muscle",
        sportPlayed: "",
        currentWeightKg: "82",
        additionalInfo: "Updated",
      },
      cookie
    );

    expect(res.status).toBe(200);
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);

    const saved = mockSaveProfile.mock.calls[0][0];
    expect(saved.fullName).toBe("New Name");
    expect(saved.primaryGoal).toBe("Build Muscle");
    expect(saved.userId).toBe(EXISTING_PROFILE.userId);
    expect(saved.email).toBe(EXISTING_PROFILE.email);
    expect(saved.createdAt).toBe(EXISTING_PROFILE.createdAt);
    expect(saved.onboardingCompleted).toBe(EXISTING_PROFILE.onboardingCompleted);
    expect(saved.updatedAt).not.toBe(EXISTING_PROFILE.updatedAt);
  });

  it("rejects a missing full name with 400", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callProfileUpdate(
      { fullName: "", phone: "555-1111", gender: "Male", primaryGoal: "Build Muscle" },
      cookie
    );

    expect(res.status).toBe(400);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });
});
