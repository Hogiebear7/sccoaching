import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockSetUserArchived } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockSetUserArchived: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  setUserArchived: mockSetUserArchived,
}));

const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "staff" as const };
const COACH_USER = { id: "coach-1", email: "realcoach@example.com", role: "coach" as const };
const MEMBER_USER = { id: "member-1", email: "member@example.com", role: "member" as const };

async function callArchive(targetUserId: string, body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/staff/members/[userId]/archive/route");
  const request = new NextRequest(`http://localhost/api/staff/members/${targetUserId}/archive`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ userId: targetUserId }) });
}

describe("POST /api/staff/members/[userId]/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockImplementation((id: string) =>
      id === STAFF_USER.id
        ? STAFF_USER
        : id === COACH_USER.id
          ? COACH_USER
          : id === MEMBER_USER.id
            ? MEMBER_USER
            : undefined
    );
    mockSetUserArchived.mockReturnValue(true);
  });

  it("rejects non-staff sessions", async () => {
    const res = await callArchive(
      MEMBER_USER.id,
      { archived: true },
      signSession({ userId: MEMBER_USER.id })
    );

    expect(res.status).toBe(403);
    expect(mockSetUserArchived).not.toHaveBeenCalled();
  });

  it("forbids a COACH from archiving (account-security is admin+)", async () => {
    const res = await callArchive(
      MEMBER_USER.id,
      { archived: true },
      signSession({ userId: COACH_USER.id })
    );

    expect(res.status).toBe(403);
    expect(mockSetUserArchived).not.toHaveBeenCalled();
  });

  it("refuses to archive a staff account", async () => {
    const res = await callArchive(
      STAFF_USER.id,
      { archived: true },
      signSession({ userId: STAFF_USER.id })
    );

    expect(res.status).toBe(400);
    expect(mockSetUserArchived).not.toHaveBeenCalled();
  });

  it("requires a boolean archived flag", async () => {
    const res = await callArchive(
      MEMBER_USER.id,
      { archived: "yes" },
      signSession({ userId: STAFF_USER.id })
    );

    expect(res.status).toBe(400);
    expect(mockSetUserArchived).not.toHaveBeenCalled();
  });

  it("archives and restores a member account", async () => {
    const archiveRes = await callArchive(
      MEMBER_USER.id,
      { archived: true },
      signSession({ userId: STAFF_USER.id })
    );
    expect(archiveRes.status).toBe(200);
    expect(mockSetUserArchived).toHaveBeenCalledWith(MEMBER_USER.id, true);

    const restoreRes = await callArchive(
      MEMBER_USER.id,
      { archived: false },
      signSession({ userId: STAFF_USER.id })
    );
    expect(restoreRes.status).toBe(200);
    expect(mockSetUserArchived).toHaveBeenCalledWith(MEMBER_USER.id, false);
  });
});
