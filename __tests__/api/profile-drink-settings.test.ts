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

const MEMBER_USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };

const PROFILE = {
  userId: "user-1",
  fullName: "Alex Rivera",
  email: "athlete@example.com",
  drinkSettings: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callSave(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/profile/drink-settings/route");
  const request = new NextRequest("http://localhost/api/profile/drink-settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/profile/drink-settings", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindProfileByUserId.mockReset();
    mockSaveProfile.mockReset();
    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindProfileByUserId.mockReturnValue(PROFILE);
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callSave({ sport: "rugby" });

    expect(res.status).toBe(401);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("returns 404 when the account has no profile", async () => {
    mockFindProfileByUserId.mockReturnValue(undefined);

    const res = await callSave({ sport: "rugby" }, signSession({ userId: MEMBER_USER.id }));

    expect(res.status).toBe(404);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("rejects a non-object body", async () => {
    const res = await callSave("rugby", signSession({ userId: MEMBER_USER.id }));

    expect(res.status).toBe(400);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("normalizes and persists settings onto the member's own profile", async () => {
    const res = await callSave(
      {
        sport: "run",
        runKm: 21.1,
        runEffort: "hard",
        bottleMl: 750,
        sweat: "high",
        temp: "hot",
        junk: "dropped",
        role: "cm", // invalid for run → normalized away
      },
      signSession({ userId: MEMBER_USER.id })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);

    const saved = mockSaveProfile.mock.calls[0][0];
    expect(saved.userId).toBe(MEMBER_USER.id);
    expect(saved.drinkSettings).toEqual({
      sport: "run",
      role: "",
      durationIdx: 0,
      runKm: 21.1,
      runEffort: "hard",
      bottleMl: 750,
      sweat: "high",
      temp: "hot",
    });
    expect(saved.drinkSettings).not.toHaveProperty("junk");
    expect(data.settings).toEqual(saved.drinkSettings);
    // Staff-facing freshness stamp is set alongside the settings.
    expect(typeof saved.drinkSettingsUpdatedAt).toBe("string");
    expect(Number.isNaN(new Date(saved.drinkSettingsUpdatedAt).getTime())).toBe(false);
  });

  it("coerces fully invalid fields to safe defaults rather than rejecting", async () => {
    const res = await callSave(
      { sport: "cricket", bottleMl: 9000, sweat: "soaked" },
      signSession({ userId: MEMBER_USER.id })
    );

    expect(res.status).toBe(200);
    const saved = mockSaveProfile.mock.calls[0][0];
    expect(saved.drinkSettings.sport).toBe("soccer");
    expect(saved.drinkSettings.bottleMl).toBe(1000);
    expect(saved.drinkSettings.sweat).toBe("medium");
  });
});
