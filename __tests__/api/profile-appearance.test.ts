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
  avatarDataUrl: null,
  palette: "teal",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// Tiny but structurally valid JPEG data URL.
const VALID_AVATAR = `data:image/jpeg;base64,${"A".repeat(400)}=`;

async function callAppearance(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/profile/appearance/route");
  const request = new NextRequest("http://localhost/api/profile/appearance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/profile/appearance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockReturnValue(USER);
    mockFindProfileByUserId.mockReturnValue(PROFILE);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await callAppearance({ palette: "ocean" });
    expect(res.status).toBe(401);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("saves a preset palette and rejects unknown ones", async () => {
    const ok = await callAppearance({ palette: "ocean" }, signSession({ userId: USER.id }));
    expect(ok.status).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0].palette).toBe("ocean");

    mockSaveProfile.mockClear();
    const bad = await callAppearance({ palette: "hotpink" }, signSession({ userId: USER.id }));
    expect(bad.status).toBe(400);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("saves a preset theme and rejects unknown ones", async () => {
    const ok = await callAppearance({ theme: "forest" }, signSession({ userId: USER.id }));
    expect(ok.status).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0].theme).toBe("forest");

    mockSaveProfile.mockClear();
    const bad = await callAppearance({ theme: "neon" }, signSession({ userId: USER.id }));
    expect(bad.status).toBe(400);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("saves theme and palette together in one request", async () => {
    const res = await callAppearance(
      { theme: "plum", palette: "ember" },
      signSession({ userId: USER.id })
    );
    expect(res.status).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0]).toMatchObject({ theme: "plum", palette: "ember" });
  });

  it("saves a valid raster data URL and removes with null", async () => {
    const ok = await callAppearance(
      { avatarDataUrl: VALID_AVATAR },
      signSession({ userId: USER.id })
    );
    expect(ok.status).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0].avatarDataUrl).toBe(VALID_AVATAR);

    mockSaveProfile.mockClear();
    const removed = await callAppearance(
      { avatarDataUrl: null },
      signSession({ userId: USER.id })
    );
    expect(removed.status).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0].avatarDataUrl).toBeNull();
  });

  it("rejects SVG, external URLs, and oversized payloads", async () => {
    const cookie = signSession({ userId: USER.id });

    for (const avatarDataUrl of [
      "data:image/svg+xml;base64,AAAA",
      "https://example.com/pic.jpg",
      `data:image/jpeg;base64,${"A".repeat(400_000)}`,
    ]) {
      const res = await callAppearance({ avatarDataUrl }, cookie);
      expect(res.status).toBe(400);
    }
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it("rejects an empty update", async () => {
    const res = await callAppearance({}, signSession({ userId: USER.id }));
    expect(res.status).toBe(400);
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });
});
