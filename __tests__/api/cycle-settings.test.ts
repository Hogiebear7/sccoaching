import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindProfileByUserId,
  mockFindCycleSettingsByUserId,
  mockSaveCycleSettings,
  mockSaveProfile,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
  mockFindCycleSettingsByUserId: vi.fn(),
  mockSaveCycleSettings: vi.fn(),
  mockSaveProfile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findProfileByUserId: mockFindProfileByUserId,
  findCycleSettingsByUserId: mockFindCycleSettingsByUserId,
  saveCycleSettings: mockSaveCycleSettings,
  saveProfile: mockSaveProfile,
}));

const ELIGIBLE_PROFILE = {
  userId: "user-1",
  fullName: "Morgan Mum",
  email: "morgan@example.com",
  phone: "555-0100",
  gender: "Female",
  primaryGoal: "General Health",
  sportPlayed: null,
  currentWeightKg: 68,
  additionalInfo: null,
  cycleTrackingEligible: true,
  cycleTrackingEnabled: false,
  onboardingCompleted: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const VALID_BODY = {
  lastPeriodStartDate: "2026-06-10",
  averageCycleLengthDays: "28",
  periodLengthDays: "5",
  regularity: "Regular",
  privateNotes: "Cramps on day 1",
};

async function callSettings(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/cycle/settings/route");
  const request = new NextRequest("http://localhost/api/cycle/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/cycle/settings", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindProfileByUserId.mockReset();
    mockFindCycleSettingsByUserId.mockReset();
    mockSaveCycleSettings.mockReset();
    mockSaveProfile.mockReset();

    mockFindUserById.mockReturnValue({ id: "user-1", email: "morgan@example.com" });
    mockFindProfileByUserId.mockReturnValue(ELIGIBLE_PROFILE);
    mockFindCycleSettingsByUserId.mockReturnValue(undefined);
  });

  it("returns 401 with no session cookie", async () => {
    const res = await callSettings(VALID_BODY);

    expect(res.status).toBe(401);
    expect(mockSaveCycleSettings).not.toHaveBeenCalled();
  });

  it("returns 403 when the member is not cycle-eligible", async () => {
    mockFindProfileByUserId.mockReturnValue({
      ...ELIGIBLE_PROFILE,
      cycleTrackingEligible: false,
    });
    const cookie = signSession({ userId: "user-1" });

    const res = await callSettings(VALID_BODY, cookie);

    expect(res.status).toBe(403);
    expect(mockSaveCycleSettings).not.toHaveBeenCalled();
  });

  it("saves settings and returns 200 for a valid request", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callSettings(VALID_BODY, cookie);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSaveCycleSettings).toHaveBeenCalledTimes(1);

    const saved = mockSaveCycleSettings.mock.calls[0][0];
    expect(saved.userId).toBe("user-1");
    expect(saved.lastPeriodStartDate).toBe("2026-06-10");
    expect(saved.averageCycleLengthDays).toBe(28);
    expect(saved.periodLengthDays).toBe(5);
    expect(saved.regularity).toBe("Regular");
    expect(saved.privateNotes).toBe("Cramps on day 1");
  });

  it("sets cycleTrackingEnabled on the profile when it was false", async () => {
    const cookie = signSession({ userId: "user-1" });

    await callSettings(VALID_BODY, cookie);

    expect(mockSaveProfile).toHaveBeenCalledTimes(1);
    expect(mockSaveProfile.mock.calls[0][0].cycleTrackingEnabled).toBe(true);
  });

  it("does not update the profile when cycleTrackingEnabled is already true", async () => {
    mockFindProfileByUserId.mockReturnValue({
      ...ELIGIBLE_PROFILE,
      cycleTrackingEnabled: true,
    });
    const cookie = signSession({ userId: "user-1" });

    await callSettings(VALID_BODY, cookie);

    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("preserves createdAt when updating existing settings", async () => {
    mockFindCycleSettingsByUserId.mockReturnValue({
      userId: "user-1",
      lastPeriodStartDate: "2026-05-01",
      averageCycleLengthDays: 30,
      periodLengthDays: 4,
      regularity: "Irregular",
      privateNotes: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const cookie = signSession({ userId: "user-1" });

    await callSettings(VALID_BODY, cookie);

    const saved = mockSaveCycleSettings.mock.calls[0][0];
    expect(saved.createdAt).toBe("2026-05-01T00:00:00.000Z");
    expect(saved.updatedAt).not.toBe("2026-05-01T00:00:00.000Z");
  });

  it("stores null for an unrecognised regularity value", async () => {
    const cookie = signSession({ userId: "user-1" });

    await callSettings({ ...VALID_BODY, regularity: "SomethingInvalid" }, cookie);

    expect(mockSaveCycleSettings.mock.calls[0][0].regularity).toBeNull();
  });

  it("stores null for all empty optional fields", async () => {
    const cookie = signSession({ userId: "user-1" });

    await callSettings(
      {
        lastPeriodStartDate: "",
        averageCycleLengthDays: "",
        periodLengthDays: "",
        regularity: "",
        privateNotes: "",
      },
      cookie
    );

    const saved = mockSaveCycleSettings.mock.calls[0][0];
    expect(saved.lastPeriodStartDate).toBeNull();
    expect(saved.averageCycleLengthDays).toBeNull();
    expect(saved.periodLengthDays).toBeNull();
    expect(saved.regularity).toBeNull();
    expect(saved.privateNotes).toBeNull();
  });
});
