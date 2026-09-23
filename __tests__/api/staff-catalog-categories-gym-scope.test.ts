// Cross-gym isolation test for
// app/api/staff/catalog/categories/route.ts (create/update) and
// app/api/staff/catalog/categories/delete/route.ts. Category is the tenant
// root for the catalog — packages and billing options resolve their gym
// transitively via categoryId and are NOT covered by this slice (see the
// staff-catalog-listing-gym-scope.test.ts file header for why filtering
// categories alone is sufficient to keep them out of the rendered page).
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findMembershipCategoryById: vi.fn(),
  saveMembershipCategory: vi.fn(),
  countPackagesByCategoryId: vi.fn(),
  deleteMembershipCategory: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const GYM_B_STAFF = { id: "staff-b", email: "staffb@x.test", role: "admin" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };

const GYM_A_CATEGORY = {
  id: "cat-a",
  gymId: null,
  name: "Semi-Private PT",
  slug: "semi-private-pt",
  description: null,
  sortOrder: 0,
  visible: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function post(path: "categories" | "categories/delete", body: unknown, sessionUserId?: string) {
  const mod = await import(`@/app/api/staff/catalog/${path}/route`);
  const req = new NextRequest(`http://localhost/api/staff/catalog/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return mod.POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_STAFF, GYM_B_STAFF, GYM_A_COACH].find((u) => u.id === id)
  );
  h.countPackagesByCategoryId.mockReturnValue(0);
});

describe("POST /api/staff/catalog/categories (create/update)", () => {
  it("creates a new category and persists it under the authenticated staff member's own gym", async () => {
    const res = await post("categories", { name: "New Category" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ success: true, message: "Category created." });
    expect(h.saveMembershipCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: GYM_A_STAFF.gymId }));
  });

  it("ignores a client-supplied gymId on create — the authenticated staff member's own gym always wins", async () => {
    await post("categories", { name: "New Category", gymId: "attacker-gym" }, GYM_A_STAFF.id);

    expect(h.saveMembershipCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: GYM_A_STAFF.gymId }));
    expect(h.saveMembershipCategory).not.toHaveBeenCalledWith(expect.objectContaining({ gymId: "attacker-gym" }));
  });

  it("allows a same-gym staff member to update an existing category", async () => {
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);

    const res = await post("categories", { id: GYM_A_CATEGORY.id, name: "Renamed" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Category updated.");
    expect(h.saveMembershipCategory).toHaveBeenCalledWith(expect.objectContaining({ id: GYM_A_CATEGORY.id, name: "Renamed" }));
  });

  it("denies a cross-gym staff member updating a category, using the existing not-found response", async () => {
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);
    const crossGymRes = await post("categories", { id: GYM_A_CATEGORY.id, name: "Hijacked" }, GYM_B_STAFF.id);
    const crossGymData = await crossGymRes.json();

    h.findMembershipCategoryById.mockReturnValue(undefined);
    const missingRes = await post("categories", { id: "does-not-exist", name: "X" }, GYM_A_STAFF.id);
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(crossGymData.message).toBe("This category no longer exists.");
  });

  it("does not call saveMembershipCategory on a cross-gym update attempt", async () => {
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);
    await post("categories", { id: GYM_A_CATEGORY.id, name: "Hijacked" }, GYM_B_STAFF.id);
    expect(h.saveMembershipCategory).not.toHaveBeenCalled();
  });

  it("does not let a client-supplied gymId move an existing category to another gym", async () => {
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);

    await post("categories", { id: GYM_A_CATEGORY.id, name: "Renamed", gymId: "attacker-gym" }, GYM_A_STAFF.id);

    expect(h.saveMembershipCategory).toHaveBeenCalledWith(expect.objectContaining({ gymId: GYM_A_CATEGORY.gymId }));
  });

  it("fails closed for a missing category id on update", async () => {
    h.findMembershipCategoryById.mockReturnValue(undefined);

    const res = await post("categories", { id: "does-not-exist", name: "X" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("This category no longer exists.");
    expect(h.saveMembershipCategory).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post("categories", { name: "X" });
    expect(res.status).toBe(401);
    expect(h.saveMembershipCategory).not.toHaveBeenCalled();
  });

  it("rejects a role without catalog.manage (coach)", async () => {
    const res = await post("categories", { name: "X" }, GYM_A_COACH.id);
    expect(res.status).toBe(403);
    expect(h.saveMembershipCategory).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/catalog/categories/delete", () => {
  it("allows a same-gym staff member to delete a category", async () => {
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);

    const res = await post("categories/delete", { id: GYM_A_CATEGORY.id }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(h.deleteMembershipCategory).toHaveBeenCalledWith(GYM_A_CATEGORY.id);
  });

  it("denies a cross-gym staff member deleting a category, using the existing not-found response", async () => {
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);
    const crossGymRes = await post("categories/delete", { id: GYM_A_CATEGORY.id }, GYM_B_STAFF.id);
    const crossGymData = await crossGymRes.json();

    h.findMembershipCategoryById.mockReturnValue(undefined);
    const missingRes = await post("categories/delete", { id: "does-not-exist" }, GYM_A_STAFF.id);
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(crossGymData.message).toBe("This category no longer exists.");
  });

  it("does not call deleteMembershipCategory on a cross-gym delete attempt", async () => {
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);
    await post("categories/delete", { id: GYM_A_CATEGORY.id }, GYM_B_STAFF.id);
    expect(h.deleteMembershipCategory).not.toHaveBeenCalled();
    expect(h.countPackagesByCategoryId).not.toHaveBeenCalled();
  });

  it("fails closed for a missing category id on delete", async () => {
    h.findMembershipCategoryById.mockReturnValue(undefined);

    const res = await post("categories/delete", { id: "does-not-exist" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("This category no longer exists.");
    expect(h.deleteMembershipCategory).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post("categories/delete", { id: GYM_A_CATEGORY.id });
    expect(res.status).toBe(401);
    expect(h.deleteMembershipCategory).not.toHaveBeenCalled();
  });

  it("rejects a role without catalog.manage (coach)", async () => {
    const res = await post("categories/delete", { id: GYM_A_CATEGORY.id }, GYM_A_COACH.id);
    expect(res.status).toBe(403);
    expect(h.deleteMembershipCategory).not.toHaveBeenCalled();
  });

  it("preserves the existing in-use guard for a same-gym category", async () => {
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);
    h.countPackagesByCategoryId.mockReturnValue(2);

    const res = await post("categories/delete", { id: GYM_A_CATEGORY.id }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toContain("2 packages");
    expect(h.deleteMembershipCategory).not.toHaveBeenCalled();
  });
});
