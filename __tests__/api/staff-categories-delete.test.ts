import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

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
      ...(actorId ? { Cookie: `session=${signSession({ userId: actorId })}` } : {}),
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
