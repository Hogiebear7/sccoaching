import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindProfileByUserId,
  mockFindCyclePrivacyByUserId,
  mockSaveCyclePrivacy,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
  mockFindCyclePrivacyByUserId: vi.fn(),
  mockSaveCyclePrivacy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findProfileByUserId: mockFindProfileByUserId,
  findCyclePrivacyByUserId: mockFindCyclePrivacyByUserId,
  saveCyclePrivacy: mockSaveCyclePrivacy,
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
  cycleTrackingEnabled: true,
  onboardingCompleted: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callPrivacy(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/cycle/privacy/route");
  const request = new NextRequest("http://localhost/api/cycle/privacy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/cycle/privacy", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindProfileByUserId.mockReset();
    mockFindCyclePrivacyByUserId.mockReset();
    mockSaveCyclePrivacy.mockReset();

    mockFindUserById.mockReturnValue({ id: "user-1", email: "morgan@example.com" });
    mockFindProfileByUserId.mockReturnValue(ELIGIBLE_PROFILE);
    mockFindCyclePrivacyByUserId.mockReturnValue(undefined);
  });

  it("returns 401 with no session cookie", async () => {
    const res = await callPrivacy({
      shareCurrentPhaseWithCoach: true,
      shareExactDatesWithCoach: false,
      shareNotesWithCoach: false,
    });

    expect(res.status).toBe(401);
    expect(mockSaveCyclePrivacy).not.toHaveBeenCalled();
  });

  it("returns 403 when the member is not cycle-eligible", async () => {
    mockFindProfileByUserId.mockReturnValue({
      ...ELIGIBLE_PROFILE,
      cycleTrackingEligible: false,
    });
    const cookie = signSession({ userId: "user-1" });

    const res = await callPrivacy(
      { shareCurrentPhaseWithCoach: true, shareExactDatesWithCoach: false, shareNotesWithCoach: false },
      cookie
    );

    expect(res.status).toBe(403);
    expect(mockSaveCyclePrivacy).not.toHaveBeenCalled();
  });

  it("saves all-false prefs and returns 200 (privacy-by-default check)", async () => {
    const cookie = signSession({ userId: "user-1" });

    const res = await callPrivacy(
      { shareCurrentPhaseWithCoach: false, shareExactDatesWithCoach: false, shareNotesWithCoach: false },
      cookie
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSaveCyclePrivacy).toHaveBeenCalledTimes(1);

    const saved = mockSaveCyclePrivacy.mock.calls[0][0];
    expect(saved.shareCurrentPhaseWithCoach).toBe(false);
    expect(saved.shareExactDatesWithCoach).toBe(false);
    expect(saved.shareNotesWithCoach).toBe(false);
  });

  it("saves explicit true values correctly", async () => {
    const cookie = signSession({ userId: "user-1" });

    await callPrivacy(
      { shareCurrentPhaseWithCoach: true, shareExactDatesWithCoach: true, shareNotesWithCoach: false },
      cookie
    );

    const saved = mockSaveCyclePrivacy.mock.calls[0][0];
    expect(saved.shareCurrentPhaseWithCoach).toBe(true);
    expect(saved.shareExactDatesWithCoach).toBe(true);
    expect(saved.shareNotesWithCoach).toBe(false);
    expect(saved.userId).toBe("user-1");
  });

  it("treats missing fields as false (Boolean coercion)", async () => {
    const cookie = signSession({ userId: "user-1" });

    await callPrivacy({}, cookie);

    const saved = mockSaveCyclePrivacy.mock.calls[0][0];
    expect(saved.shareCurrentPhaseWithCoach).toBe(false);
    expect(saved.shareExactDatesWithCoach).toBe(false);
    expect(saved.shareNotesWithCoach).toBe(false);
  });

  it("preserves createdAt when updating existing prefs", async () => {
    mockFindCyclePrivacyByUserId.mockReturnValue({
      userId: "user-1",
      shareCurrentPhaseWithCoach: false,
      shareExactDatesWithCoach: false,
      shareNotesWithCoach: false,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const cookie = signSession({ userId: "user-1" });

    await callPrivacy(
      { shareCurrentPhaseWithCoach: true, shareExactDatesWithCoach: false, shareNotesWithCoach: false },
      cookie
    );

    const saved = mockSaveCyclePrivacy.mock.calls[0][0];
    expect(saved.createdAt).toBe("2026-05-01T00:00:00.000Z");
    expect(saved.updatedAt).not.toBe("2026-05-01T00:00:00.000Z");
  });
});
