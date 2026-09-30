// Gym isolation for POST /api/staff/categories (create + edit). A category
// is stamped with the CREATING staff member's own gym, never a client-
// supplied one; an edit can never move it to another gym; a category id
// that resolves to a different gym is denied exactly like a missing one.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockFindUserById, mockFindClassCategoryById, mockFindClassCategoryBySlug, mockSaveClassCategory } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassCategoryById: vi.fn(),
  mockFindClassCategoryBySlug: vi.fn(),
  mockSaveClassCategory: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassCategoryById: mockFindClassCategoryById,
  findClassCategoryBySlug: mockFindClassCategoryBySlug,
  saveClassCategory: mockSaveClassCategory,
}));

const ADMIN_A = { id: "adm-a", email: "a@club.com", role: "admin" as const, archivedAt: null, gymId: "gym-a" };
const ADMIN_B = { id: "adm-b", email: "b@club.com", role: "admin" as const, archivedAt: null, gymId: "gym-b" };
const PRIMARY_ADMIN = { id: "adm-primary", email: "p@club.com", role: "admin" as const, archivedAt: null, gymId: null };
const GYM_A_CATEGORY = { id: "cat-a", name: "Strength", slug: "strength", gymId: "gym-a", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" };

async function call(body: unknown, actorId: string | null) {
  const { POST } = await import("@/app/api/staff/categories/route");
  const req = new NextRequest("http://localhost/api/staff/categories", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(actorId ? { Cookie: `session=${signSession({ userId: actorId }, MEMBER_SESSION_LIFETIME_MS)}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUserById.mockImplementation((id: string) =>
    [ADMIN_A, ADMIN_B, PRIMARY_ADMIN].find((u) => u.id === id)
  );
  mockFindClassCategoryById.mockReturnValue(undefined);
  mockFindClassCategoryBySlug.mockReturnValue(undefined);
});

describe("POST /api/staff/categories — creation stamps the creator's own gym", () => {
  it("stamps a new category with the creating staff member's gymId", async () => {
    const res = await call({ name: "Yoga" }, ADMIN_A.id);
    expect(res.status).toBe(200);
    expect(mockSaveClassCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: "gym-a" }));
  });

  it("stamps a Gym B category with Gym B's own gymId, independent of Gym A", async () => {
    const res = await call({ name: "Pilates" }, ADMIN_B.id);
    expect(res.status).toBe(200);
    expect(mockSaveClassCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: "gym-b" }));
  });

  it("stamps { gymId: null } for the primary gym, matching the established convention", async () => {
    const res = await call({ name: "Yoga" }, PRIMARY_ADMIN.id);
    expect(res.status).toBe(200);
    expect(mockSaveClassCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: null }));
  });

  it("ignores a client-supplied gymId entirely", async () => {
    const res = await call({ name: "Yoga", gymId: "gym-b-attempt" }, ADMIN_A.id);
    expect(res.status).toBe(200);
    expect(mockSaveClassCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: "gym-a" }));
  });
});

describe("POST /api/staff/categories — editing an existing category", () => {
  it("allows the owning gym's staff member to rename it, preserving gymId", async () => {
    mockFindClassCategoryById.mockReturnValue(GYM_A_CATEGORY);
    const res = await call({ id: GYM_A_CATEGORY.id, name: "Strength Training" }, ADMIN_A.id);
    expect(res.status).toBe(200);
    expect(mockSaveClassCategory).toHaveBeenCalledWith(expect.objectContaining({ id: GYM_A_CATEGORY.id, gymId: "gym-a" }));
  });

  it("denies a cross-gym staff member editing it — same not-found response as a missing id", async () => {
    mockFindClassCategoryById.mockReturnValue(GYM_A_CATEGORY);
    const crossGym = await call({ id: GYM_A_CATEGORY.id, name: "Hijacked" }, ADMIN_B.id);
    const crossGymBody = await crossGym.json();

    expect(crossGym.status).toBe(404);
    expect(crossGymBody).toEqual({ success: false, message: "Category not found." });
    expect(mockSaveClassCategory).not.toHaveBeenCalled();
  });

  it("a client-supplied gymId in the edit body cannot move a category to another gym", async () => {
    mockFindClassCategoryById.mockReturnValue(GYM_A_CATEGORY);
    const res = await call({ id: GYM_A_CATEGORY.id, name: "Strength", gymId: "gym-b" }, ADMIN_A.id);
    expect(res.status).toBe(200);
    expect(mockSaveClassCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: "gym-a" }));
  });

  it("a legacy category with no stored gymId is editable by the primary gym's own staff", async () => {
    mockFindClassCategoryById.mockReturnValue({ ...GYM_A_CATEGORY, gymId: undefined });
    const res = await call({ id: GYM_A_CATEGORY.id, name: "Renamed" }, PRIMARY_ADMIN.id);
    expect(res.status).toBe(200);
    expect(mockSaveClassCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: null }));
  });

  it("a legacy category with no stored gymId is NOT editable by a real-gym staff member", async () => {
    mockFindClassCategoryById.mockReturnValue({ ...GYM_A_CATEGORY, gymId: undefined });
    const res = await call({ id: GYM_A_CATEGORY.id, name: "Hijacked" }, ADMIN_A.id);
    expect(res.status).toBe(404);
    expect(mockSaveClassCategory).not.toHaveBeenCalled();
  });
});
