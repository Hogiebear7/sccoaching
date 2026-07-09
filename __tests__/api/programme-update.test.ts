import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockFindProgrammeByUserId, mockSaveProgramme, mockFindProfileByUserId } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindProgrammeByUserId: vi.fn(),
  mockSaveProgramme: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findProgrammeByUserId: mockFindProgrammeByUserId,
  saveProgramme: mockSaveProgramme,
  findProfileByUserId: mockFindProfileByUserId,
}));

const EXISTING_PROGRAMME = {
  id: "programme-1",
  userId: "user-1",
  title: "Old Title",
  phase: null,
  focus: null,
  status: "active",
  startDate: null,
  currentWeek: 1,
  totalWeeks: 6,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function callProgrammeUpdate(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/programme/update/route");
  const request = new NextRequest("http://localhost/api/programme/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/programme/update", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindProgrammeByUserId.mockReset();
    mockSaveProgramme.mockReset();
    mockFindUserById.mockReturnValue({ id: "user-1", email: "athlete@example.com" });
    mockFindProfileByUserId.mockReset();
    mockFindProfileByUserId.mockReturnValue({ userId: "user-1", programmeEnabled: true });
    mockFindProfileByUserId.mockReset();
    mockFindProfileByUserId.mockReturnValue({ userId: "user-1", programmeEnabled: true });
  });

  it("rejects requests with no session cookie", async () => {
    const res = await callProgrammeUpdate({ title: "New Programme" });

    expect(res.status).toBe(401);
    expect(mockSaveProgramme).not.toHaveBeenCalled();
  });

  it("creates a new programme owned by the caller when none exists", async () => {
    mockFindProgrammeByUserId.mockReturnValue(undefined);
    const cookie = signSession({ userId: "user-1" });

    const res = await callProgrammeUpdate(
      { title: "First Block", currentWeek: "1", totalWeeks: "6" },
      cookie
    );

    expect(res.status).toBe(200);
    const saved = mockSaveProgramme.mock.calls[0][0];
    expect(saved.userId).toBe("user-1");
    expect(saved.title).toBe("First Block");
    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBe(saved.updatedAt);
  });

  it("updates an existing programme, preserving id, userId, and createdAt", async () => {
    mockFindProgrammeByUserId.mockReturnValue(EXISTING_PROGRAMME);
    const cookie = signSession({ userId: "user-1" });

    const res = await callProgrammeUpdate(
      { title: "Updated Block", status: "paused", currentWeek: "3", totalWeeks: "6" },
      cookie
    );

    expect(res.status).toBe(200);
    const saved = mockSaveProgramme.mock.calls[0][0];
    expect(saved.id).toBe(EXISTING_PROGRAMME.id);
    expect(saved.userId).toBe(EXISTING_PROGRAMME.userId);
    expect(saved.createdAt).toBe(EXISTING_PROGRAMME.createdAt);
    expect(saved.title).toBe("Updated Block");
    expect(saved.status).toBe("paused");
    expect(saved.updatedAt).not.toBe(EXISTING_PROGRAMME.updatedAt);
  });

  it("rejects a missing title with 400", async () => {
    mockFindProgrammeByUserId.mockReturnValue(undefined);
    const cookie = signSession({ userId: "user-1" });

    const res = await callProgrammeUpdate({ title: "" }, cookie);

    expect(res.status).toBe(400);
    expect(mockSaveProgramme).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value with 400", async () => {
    mockFindProgrammeByUserId.mockReturnValue(undefined);
    const cookie = signSession({ userId: "user-1" });

    const res = await callProgrammeUpdate({ title: "Valid Title", status: "bogus" }, cookie);

    expect(res.status).toBe(400);
    expect(mockSaveProgramme).not.toHaveBeenCalled();
  });

  it("rejects with 403 when programme access isn't enabled for the member", async () => {
    mockFindProfileByUserId.mockReturnValue({ userId: "user-1", programmeEnabled: false });
    const cookie = signSession({ userId: "user-1" });

    const res = await callProgrammeUpdate({ title: "Valid Title" }, cookie);

    expect(res.status).toBe(403);
    expect(mockSaveProgramme).not.toHaveBeenCalled();
  });
});
