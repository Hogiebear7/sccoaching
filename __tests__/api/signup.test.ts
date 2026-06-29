import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifySession } from "@/lib/session";

const { mockFindUserByEmail, mockCreateUser, mockSaveProfile, mockSaveCycleSettings, mockSaveCyclePrivacy } =
  vi.hoisted(() => ({
    mockFindUserByEmail: vi.fn(),
    mockCreateUser: vi.fn(),
    mockSaveProfile: vi.fn(),
    mockSaveCycleSettings: vi.fn(),
    mockSaveCyclePrivacy: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  findUserByEmail: mockFindUserByEmail,
  createUser: mockCreateUser,
  saveProfile: mockSaveProfile,
  saveCycleSettings: mockSaveCycleSettings,
  saveCyclePrivacy: mockSaveCyclePrivacy,
}));

const VALID_PAYLOAD = {
  email: "new-athlete@example.com",
  password: "Str0ng!Pass",
  fullName: "New Athlete",
  phone: "555-0100",
  gender: "Female",
  primaryGoal: "General Health",
  currentWeightKg: "65",
  additionalInfo: "",
  cycleTrackingEnabled: true,
};

async function callSignup(body: unknown) {
  const { POST } = await import("@/app/api/auth/signup/route");
  const request = new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    mockFindUserByEmail.mockReset();
    mockCreateUser.mockReset();
    mockSaveProfile.mockReset();
    mockSaveCycleSettings.mockReset();
    mockSaveCyclePrivacy.mockReset();
    mockFindUserByEmail.mockReturnValue(undefined);
    mockCreateUser.mockReturnValue({
      id: "user-2",
      email: VALID_PAYLOAD.email,
      createdAt: "now",
      updatedAt: "now",
    });
  });

  it("creates a user and profile, and sets a verifiable session cookie", async () => {
    const res = await callSignup(VALID_PAYLOAD);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);

    const savedProfile = mockSaveProfile.mock.calls[0][0];
    expect(savedProfile.userId).toBe("user-2");
    expect(savedProfile.fullName).toBe("New Athlete");
    expect(savedProfile.cycleTrackingEligible).toBe(true);
    expect(savedProfile.cycleTrackingEnabled).toBe(true);

    expect(mockSaveCycleSettings).toHaveBeenCalledTimes(1);
    expect(mockSaveCyclePrivacy).toHaveBeenCalledTimes(1);
    expect(mockSaveCycleSettings.mock.calls[0][0].userId).toBe("user-2");
    expect(mockSaveCyclePrivacy.mock.calls[0][0].shareCurrentPhaseWithCoach).toBe(false);

    const sessionCookie = res.cookies.get("session");
    expect(verifySession(sessionCookie!.value)?.userId).toBe("user-2");
  });

  it("rejects a weak password without creating a user", async () => {
    const res = await callSignup({ ...VALID_PAYLOAD, password: "weak" });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email with a generic message (no enumeration)", async () => {
    mockFindUserByEmail.mockReturnValue({ id: "existing-user", email: VALID_PAYLOAD.email });

    const res = await callSignup(VALID_PAYLOAD);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("Unable to create account.");
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("requires sportPlayed when the goal is Sports Performance", async () => {
    const res = await callSignup({
      ...VALID_PAYLOAD,
      primaryGoal: "Sports Performance",
      sportPlayed: "",
    });

    expect(res.status).toBe(400);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
