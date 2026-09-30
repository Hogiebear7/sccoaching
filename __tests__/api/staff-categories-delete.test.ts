import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindClassCategoryById,
  mockCountClasses,
  mockCountPackages,
  mockDeleteClassCategory,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindClassCategoryById: vi.fn(),
  mockCountClasses: vi.fn(),
  mockCountPackages: vi.fn(),
  mockDeleteClassCategory: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findClassCategoryById: mockFindClassCategoryById,
  countClassesByCategorySlug: mockCountClasses,
  countPackagesByEligibleClassType: mockCountPackages,
  deleteClassCategory: mockDeleteClassCategory,
}));

const ADMIN = { id: "adm-1", email: "adm@club.com", role: "admin" as const, archivedAt: null };
const COACH = { id: "coach-1", email: "c@club.com", role: "coach" as const, archivedAt: null };
const CATEGORY = { id: "cat-1", name: "Strength", slug: "strength", createdAt: "x", updatedAt: "x" };

async function callDelete(body: unknown, actorId: string | null) {
  const { POST } = await import("@/app/api/staff/categories/delete/route");
  const req = new NextRequest("http://localhost/api/staff/categories/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(actorId ? { Cookie: `session=${signSession({ userId: actorId }, MEMBER_SESSION_LIFETIME_MS)}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/staff/categories/delete (guarded)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockImplementation((id: string) =>
      id === ADMIN.id ? ADMIN : id === COACH.id ? COACH : undefined
    );
    mockFindClassCategoryById.mockReturnValue(CATEGORY);
    mockCountClasses.mockReturnValue(0);
    mockCountPackages.mockReturnValue(0);
  });

  it("deletes an unused class type", async () => {
    const res = await callDelete({ id: CATEGORY.id }, ADMIN.id);
    expect(res.status).toBe(200);
    expect(mockDeleteClassCategory).toHaveBeenCalledWith(CATEGORY.id);
  });

  it("BLOCKS deletion when classes reference it (409, no delete)", async () => {
    mockCountClasses.mockReturnValue(3);
    const res = await callDelete({ id: CATEGORY.id }, ADMIN.id);
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.message).toMatch(/3 classes/);
    expect(mockDeleteClassCategory).not.toHaveBeenCalled();
  });

  it("BLOCKS deletion when packages reference it (409, no delete)", async () => {
    mockCountPackages.mockReturnValue(1);
    const res = await callDelete({ id: CATEGORY.id }, ADMIN.id);
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.message).toMatch(/1 package/);
    expect(mockDeleteClassCategory).not.toHaveBeenCalled();
  });

  it("forbids a coach (operations.view is admin+) — 403", async () => {
    const res = await callDelete({ id: CATEGORY.id }, COACH.id);
    expect(res.status).toBe(403);
    expect(mockDeleteClassCategory).not.toHaveBeenCalled();
  });

  it("requires a signed-in user — 401", async () => {
    const res = await callDelete({ id: CATEGORY.id }, null);
    expect(res.status).toBe(401);
  });

  it("404s an unknown category", async () => {
    mockFindClassCategoryById.mockReturnValue(undefined);
    const res = await callDelete({ id: "gone" }, ADMIN.id);
    expect(res.status).toBe(404);
  });
});

// Cross-gym isolation: a category id that resolves to a DIFFERENT gym reads
// exactly like a missing one — never revealed, never deletable.
describe("POST /api/staff/categories/delete — gym scope", () => {
  const ADMIN_A = { id: "adm-a", email: "a@club.com", role: "admin" as const, archivedAt: null, gymId: "gym-a" };
  const ADMIN_B = { id: "adm-b", email: "b@club.com", role: "admin" as const, archivedAt: null, gymId: "gym-b" };
  const GYM_A_CATEGORY = { id: "cat-a", name: "Strength", slug: "strength", gymId: "gym-a", createdAt: "x", updatedAt: "x" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockImplementation((id: string) => (id === ADMIN_A.id ? ADMIN_A : id === ADMIN_B.id ? ADMIN_B : undefined));
    mockFindClassCategoryById.mockReturnValue(GYM_A_CATEGORY);
    mockCountClasses.mockReturnValue(0);
    mockCountPackages.mockReturnValue(0);
  });

  it("denies a cross-gym staff member with the same not-found response as a missing category", async () => {
    const crossGym = await callDelete({ id: GYM_A_CATEGORY.id }, ADMIN_B.id);
    const crossGymBody = await crossGym.json();

    mockFindClassCategoryById.mockReturnValue(undefined);
    const missing = await callDelete({ id: "gone" }, ADMIN_B.id);
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(404);
    expect(crossGym.status).toBe(missing.status);
    expect(crossGymBody).toEqual(missingBody);
    expect(mockDeleteClassCategory).not.toHaveBeenCalled();
  });

  it("allows the owning gym's staff member to delete it", async () => {
    const res = await callDelete({ id: GYM_A_CATEGORY.id }, ADMIN_A.id);
    expect(res.status).toBe(200);
    expect(mockDeleteClassCategory).toHaveBeenCalledWith(GYM_A_CATEGORY.id);
  });

  it("a category with no stored gymId (legacy row) is treated as the primary gym", async () => {
    mockFindClassCategoryById.mockReturnValue({ ...GYM_A_CATEGORY, gymId: undefined });
    const primaryGymAdmin = { ...ADMIN_A, gymId: null };
    mockFindUserById.mockImplementation((id: string) => (id === primaryGymAdmin.id ? primaryGymAdmin : undefined));

    const res = await callDelete({ id: GYM_A_CATEGORY.id }, primaryGymAdmin.id);
    expect(res.status).toBe(200);
  });
});
