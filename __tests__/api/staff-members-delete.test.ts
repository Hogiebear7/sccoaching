import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const { mockFindUserById, mockDeleteUserAndOwnedRecords } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockDeleteUserAndOwnedRecords: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  deleteUserAndOwnedRecords: mockDeleteUserAndOwnedRecords,
}));

const MANAGER = { id: "mgr-1", email: "mgr@club.com", role: "admin_manager" as const, archivedAt: null };
const ADMIN = { id: "adm-1", email: "adm@club.com", role: "admin" as const, archivedAt: null };
const ARCHIVED_MEMBER = { id: "m-1", email: "old@x.com", role: "member" as const, archivedAt: "2026-01-01T00:00:00.000Z" };
const ACTIVE_MEMBER = { id: "m-2", email: "active@x.com", role: "member" as const, archivedAt: null };

const USERS: Record<string, unknown> = {
  "mgr-1": MANAGER,
  "adm-1": ADMIN,
  "m-1": ARCHIVED_MEMBER,
  "m-2": ACTIVE_MEMBER,
};

async function callDelete(targetId: string, actorId: string) {
  const { POST } = await import("@/app/api/staff/members/[userId]/delete/route");
  const req = new NextRequest(`http://localhost/api/staff/members/${targetId}/delete`, {
    method: "POST",
    headers: { Cookie: `session=${signSession({ userId: actorId })}` },
  });
  return POST(req, { params: Promise.resolve({ userId: targetId }) });
}

describe("POST /api/staff/members/[userId]/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockImplementation((id: string) => USERS[id]);
    mockDeleteUserAndOwnedRecords.mockReturnValue({ users: 1, subscriptions: 1, bookings: 2 });
  });

  it("lets an admin_manager permanently delete an ARCHIVED member", async () => {
    const res = await callDelete(ARCHIVED_MEMBER.id, MANAGER.id);
    expect(res.status).toBe(200);
    expect(mockDeleteUserAndOwnedRecords).toHaveBeenCalledWith(ARCHIVED_MEMBER.id);
  });

  it("forbids an admin (not admin_manager) — 403", async () => {
    const res = await callDelete(ARCHIVED_MEMBER.id, ADMIN.id);
    expect(res.status).toBe(403);
    expect(mockDeleteUserAndOwnedRecords).not.toHaveBeenCalled();
  });

  it("refuses to delete an ACTIVE member — 409", async () => {
    const res = await callDelete(ACTIVE_MEMBER.id, MANAGER.id);
    expect(res.status).toBe(409);
    expect(mockDeleteUserAndOwnedRecords).not.toHaveBeenCalled();
  });

  it("refuses to delete a staff account — 400", async () => {
    const res = await callDelete(ADMIN.id, MANAGER.id);
    expect(res.status).toBe(400);
    expect(mockDeleteUserAndOwnedRecords).not.toHaveBeenCalled();
  });

  it("404s an unknown user", async () => {
    const res = await callDelete("nope", MANAGER.id);
    expect(res.status).toBe(404);
  });
});
