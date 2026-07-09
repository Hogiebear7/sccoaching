import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindProfileByUserId,
  mockSaveProfile,
  mockFindBodyWeightLogs,
  mockSaveBodyWeightLog,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
  mockSaveProfile: vi.fn(),
  mockFindBodyWeightLogs: vi.fn(),
  mockSaveBodyWeightLog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findProfileByUserId: mockFindProfileByUserId,
  saveProfile: mockSaveProfile,
  findBodyWeightLogsByUserId: mockFindBodyWeightLogs,
  saveBodyWeightLog: mockSaveBodyWeightLog,
}));

const EXISTING_PROFILE = {
  userId: "user-1",
  fullName: "Old Name",
  email: "athlete@example.com",
  phone: "555-0000",
  dateOfBirth: "1994-03-12",
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

const VALID_BODY = {
  fullName: "New Name",
  phone: "555-1111",
  dateOfBirth: "1994-03-12",
  gender: "Male",
  primaryGoal: "Build Muscle",
  sportPlayed: "",
  currentWeightKg: "82",
  additionalInfo: "Updated",
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
    mockFindBodyWeightLogs.mockReset();
    mockSaveBodyWeightLog.mockReset();
    mockFindUserById.mockReturnValue({ id: "user-1", email: "athlete@example.com" });
    mockFindProfileByUserId.mockReturnValue(EXISTING_PROFILE);
    mockFindBodyWeightLogs.mockReturnValue([]);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callProfileUpdate({ fullName: "New Name" });

    expect(res.status).toBe(401);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("updates editable fields while preserving immutable ones", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callProfileUpdate(VALID_BODY, cookie);

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

    const res = await callProfileUpdate({ ...VALID_BODY, fullName: "" }, cookie);

    expect(res.status).toBe(400);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("rejects a missing date of birth with 400", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callProfileUpdate({ ...VALID_BODY, dateOfBirth: "" }, cookie);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toBe("Date of birth is required.");
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("rejects a future or malformed date of birth with 400", async () => {
    const cookie = signSession({ userId: "user-1" });

    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const futureISO = future.toISOString().slice(0, 10);

    for (const bad of [futureISO, "not-a-date", "1994-13-45"]) {
      const res = await callProfileUpdate({ ...VALID_BODY, dateOfBirth: bad }, cookie);
      expect(res.status, `expected 400 for dateOfBirth="${bad}"`).toBe(400);
    }
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("ignores manually submitted weight — read-only after signup", async () => {
    const cookie = signSession({ userId: "user-1" });
    mockFindBodyWeightLogs.mockReturnValue([
      { id: "log-1", userId: "user-1", date: "2026-07-01", weightKg: 78.5, createdAt: "2026-07-01T08:00:00.000Z" },
    ]);

    const res = await callProfileUpdate({ ...VALID_BODY, currentWeightKg: "999" }, cookie);

    expect(res.status).toBe(200);
    // No log is written and the submitted value never lands anywhere:
    // the latest logged weight remains the source of truth.
    expect(mockSaveBodyWeightLog).not.toHaveBeenCalled();
    expect(mockSaveProfile.mock.calls[0][0].currentWeightKg).toBe(78.5);
  });

  it("keeps the profile weight synced to the latest log on every save", async () => {
    const cookie = signSession({ userId: "user-1" });
    mockFindBodyWeightLogs.mockReturnValue([
      { id: "log-old", userId: "user-1", date: "2026-06-01", weightKg: 84, createdAt: "2026-06-01T08:00:00.000Z" },
      { id: "log-new", userId: "user-1", date: "2026-07-05", weightKg: 77, createdAt: "2026-07-05T08:00:00.000Z" },
    ]);

    const res = await callProfileUpdate(VALID_BODY, cookie);

    expect(res.status).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0].currentWeightKg).toBe(77);
  });

  it("falls back to the signup weight when no logs exist yet", async () => {
    const cookie = signSession({ userId: "user-1" });
    mockFindBodyWeightLogs.mockReturnValue([]);

    const res = await callProfileUpdate(VALID_BODY, cookie);

    expect(res.status).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0].currentWeightKg).toBe(EXISTING_PROFILE.currentWeightKg);
  });
});
