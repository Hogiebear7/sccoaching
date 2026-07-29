import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindUserByEmail,
  mockCreateUserWithRole,
  mockUpdateUserRole,
  mockCountActiveUsersByRole,
  mockSetUserArchived,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindUserByEmail: vi.fn(),
  mockCreateUserWithRole: vi.fn(),
  mockUpdateUserRole: vi.fn(),
  mockCountActiveUsersByRole: vi.fn(),
  mockSetUserArchived: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findUserByEmail: mockFindUserByEmail,
  createUserWithRole: mockCreateUserWithRole,
  updateUserRole: mockUpdateUserRole,
  countActiveUsersByRole: mockCountActiveUsersByRole,
  setUserArchived: mockSetUserArchived,
}));

vi.mock("@/lib/password", () => ({ hashPassword: () => "salt:hash" }));

const MANAGER = { id: "mgr-1", email: "mgr@club.com", role: "admin_manager" as const, archivedAt: null };
const ADMIN = { id: "adm-1", email: "adm@club.com", role: "admin" as const, archivedAt: null };

function cookieFor(userId: string) {
  return signSession({ userId });
}

async function callCreate(body: unknown, userId: string) {
  const { POST } = await import("@/app/api/staff/staff-users/route");
  const req = new NextRequest("http://localhost/api/staff/staff-users", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${cookieFor(userId)}` },
    body: JSON.stringify(body),
  });
  return POST(req);
}

async function callArchive(body: unknown, userId: string) {
  const { POST } = await import("@/app/api/staff/staff-users/archive/route");
  const req = new NextRequest("http://localhost/api/staff/staff-users/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${cookieFor(userId)}` },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/staff/staff-users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockImplementation((id: string) =>
      id === MANAGER.id ? MANAGER : id === ADMIN.id ? ADMIN : undefined
    );
    mockFindUserByEmail.mockReturnValue(undefined);
    mockCountActiveUsersByRole.mockReturnValue(2);
    mockCreateUserWithRole.mockReturnValue({ id: "new-1" });
  });

  it("lets an admin_manager create a coach", async () => {
    const res = await callCreate({ email: "new@club.com", password: "password1", role: "coach" }, MANAGER.id);
    expect(res.status).toBe(200);
    expect(mockCreateUserWithRole).toHaveBeenCalledWith("new@club.com", "salt:hash", "coach");
  });

  it("forbids a plain admin from managing staff users (403)", async () => {
    const res = await callCreate({ email: "x@club.com", password: "password1", role: "coach" }, ADMIN.id);
    expect(res.status).toBe(403);
    expect(mockCreateUserWithRole).not.toHaveBeenCalled();
  });

  it("rejects an unknown role (400)", async () => {
    const res = await callCreate({ email: "x@club.com", password: "password1", role: "superuser" }, MANAGER.id);
    expect(res.status).toBe(400);
  });

  it("rejects a short password (400)", async () => {
    const res = await callCreate({ email: "x@club.com", password: "short", role: "coach" }, MANAGER.id);
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email (409)", async () => {
    mockFindUserByEmail.mockReturnValue({ id: "dupe" });
    const res = await callCreate({ email: "dupe@club.com", password: "password1", role: "admin" }, MANAGER.id);
    expect(res.status).toBe(409);
  });

  it("changes an existing staff user's role", async () => {
    const res = await callCreate({ id: ADMIN.id, role: "coach" }, MANAGER.id);
    expect(res.status).toBe(200);
    expect(mockUpdateUserRole).toHaveBeenCalledWith(ADMIN.id, "coach");
  });

  it("blocks demoting the LAST admin_manager (409) and does not write", async () => {
    mockCountActiveUsersByRole.mockReturnValue(1);
    const res = await callCreate({ id: MANAGER.id, role: "admin" }, MANAGER.id);
    expect(res.status).toBe(409);
    expect(mockUpdateUserRole).not.toHaveBeenCalled();
  });

  it("allows demoting an admin_manager when another remains", async () => {
    mockCountActiveUsersByRole.mockReturnValue(2);
    mockFindUserById.mockImplementation((id: string) =>
      id === MANAGER.id ? MANAGER : { id: "mgr-2", role: "admin_manager", archivedAt: null }
    );
    const res = await callCreate({ id: "mgr-2", role: "admin" }, MANAGER.id);
    expect(res.status).toBe(200);
    expect(mockUpdateUserRole).toHaveBeenCalledWith("mgr-2", "admin");
  });
});

describe("POST /api/staff/staff-users/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockImplementation((id: string) =>
      id === MANAGER.id ? MANAGER : id === ADMIN.id ? ADMIN : undefined
    );
    mockCountActiveUsersByRole.mockReturnValue(2);
  });

  it("archives a non-last elevated user", async () => {
    const res = await callArchive({ id: ADMIN.id, archived: true }, MANAGER.id);
    expect(res.status).toBe(200);
    expect(mockSetUserArchived).toHaveBeenCalledWith(ADMIN.id, true);
  });

  it("blocks deactivating the LAST admin_manager (409)", async () => {
    mockCountActiveUsersByRole.mockReturnValue(1);
    const res = await callArchive({ id: MANAGER.id, archived: true }, MANAGER.id);
    expect(res.status).toBe(409);
    expect(mockSetUserArchived).not.toHaveBeenCalled();
  });

  it("forbids a plain admin (403)", async () => {
    const res = await callArchive({ id: ADMIN.id, archived: true }, ADMIN.id);
    expect(res.status).toBe(403);
  });
});
