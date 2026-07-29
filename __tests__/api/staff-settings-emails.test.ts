import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockGetSettings,
  mockSaveSettings,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockGetSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  getTransactionalEmailSettings: mockGetSettings,
  saveTransactionalEmailSettings: mockSaveSettings,
  TRANSACTIONAL_EMAIL_TYPES: [
    "bookingConfirmation",
    "bookingCancellation",
    "classCancelled",
    "classReminder",
  ],
}));

const ADMIN = { id: "admin-1", email: "admin@example.com", role: "admin" as const };
const COACH = { id: "coach-1", email: "coach@example.com", role: "coach" as const };
const MEMBER = { id: "member-1", email: "m@example.com", role: "member" as const };

const ALL_ON = {
  bookingConfirmation: true,
  bookingCancellation: true,
  classCancelled: true,
  classReminder: true,
};

async function callPost(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/staff/settings/emails/route");
  const request = new NextRequest("http://localhost/api/staff/settings/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/staff/settings/emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({ ...ALL_ON });
  });

  it("requires a session", async () => {
    const res = await callPost({ type: "classReminder", enabled: false });
    expect(res.status).toBe(401);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-admin staff member (operations gate)", async () => {
    mockFindUserById.mockReturnValue(COACH);
    const res = await callPost(
      { type: "classReminder", enabled: false },
      signSession({ userId: COACH.id })
    );
    expect(res.status).toBe(403);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("rejects a member", async () => {
    mockFindUserById.mockReturnValue(MEMBER);
    const res = await callPost(
      { type: "classReminder", enabled: false },
      signSession({ userId: MEMBER.id })
    );
    expect(res.status).toBe(403);
  });

  it("rejects an unknown email type", async () => {
    mockFindUserById.mockReturnValue(ADMIN);
    const res = await callPost(
      { type: "marketingBlast", enabled: false },
      signSession({ userId: ADMIN.id })
    );
    expect(res.status).toBe(400);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean enabled value", async () => {
    mockFindUserById.mockReturnValue(ADMIN);
    const res = await callPost(
      { type: "classReminder", enabled: "no" },
      signSession({ userId: ADMIN.id })
    );
    expect(res.status).toBe(400);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("saves a single toggle merged over the current settings", async () => {
    mockFindUserById.mockReturnValue(ADMIN);
    const res = await callPost(
      { type: "classReminder", enabled: false },
      signSession({ userId: ADMIN.id })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockSaveSettings).toHaveBeenCalledWith({ ...ALL_ON, classReminder: false });
    // Other categories are preserved.
    expect(data.settings.bookingConfirmation).toBe(true);
    expect(data.settings.classReminder).toBe(false);
  });
});
