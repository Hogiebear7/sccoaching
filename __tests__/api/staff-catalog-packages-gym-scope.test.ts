// Cross-gym isolation test for
// app/api/staff/catalog/packages/route.ts (create/update) and
// app/api/staff/catalog/packages/delete/route.ts. Ordinary packages
// resolve their gym transitively via categoryId -> category.gymId. A
// package with deliveryChannel: "app_only" is the sole global-access
// exception (see the approved decision record) — deliberately NOT keyed on
// billingChannel, package slug, or gymId === null.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findMembershipCategoryById: vi.fn(),
  findMembershipPackageById: vi.fn(),
  saveMembershipPackage: vi.fn(),
  countBillingOptionsByPackageId: vi.fn(),
  countSubscriptionsByPackageId: vi.fn(),
  deleteMembershipPackage: vi.fn(),
  findClassCategories: vi.fn(),
  DELIVERY_CHANNELS: ["in_person", "hybrid", "app_only"],
  BILLING_CHANNELS: ["stripe_web", "apple_iap", "google_play", "manual"],
  ACCESS_TYPES: ["membership", "pass", "subscription", "add_on"],
}));
vi.mock("@/lib/db", () => h);

const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const GYM_B_STAFF = { id: "staff-b", email: "staffb@x.test", role: "admin" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };

const GYM_A_CATEGORY = { id: "cat-a", gymId: null, name: "Cat A", slug: "cat-a", description: null, sortOrder: 0, visible: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const GYM_B_CATEGORY = { ...GYM_A_CATEGORY, id: "cat-b", gymId: "gym-b" };

function ordinaryPackage(id: string, categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    categoryId,
    name: "Ordinary Package",
    slug: id,
    shortDescription: null,
    fullDescription: null,
    packageType: "membership",
    sessionAllowanceType: "unlimited",
    sessionAllowanceCount: null,
    eligibleClassTypes: [],
    visible: true,
    sortOrder: 0,
    stripeProductId: null,
    imageUrl: null,
    imageAlt: null,
    deliveryChannel: "in_person",
    billingChannel: "stripe_web",
    accessType: "membership",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function appOnlyPackage(id: string, categoryId: string) {
  return ordinaryPackage(id, categoryId, {
    name: "App Subscription",
    slug: "app-subscription-tier-2",
    deliveryChannel: "app_only",
    billingChannel: "google_play",
  });
}

async function post(path: "packages" | "packages/delete", body: unknown, sessionUserId?: string) {
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
  h.findMembershipCategoryById.mockImplementation((id: string) =>
    [GYM_A_CATEGORY, GYM_B_CATEGORY].find((c) => c.id === id)
  );
  h.countBillingOptionsByPackageId.mockReturnValue(0);
  h.countSubscriptionsByPackageId.mockReturnValue(0);
  h.findClassCategories.mockReturnValue([]);
});

describe("POST /api/staff/catalog/packages (create/update)", () => {
  it("creates an ordinary package under the staff member's own gym category", async () => {
    const res = await post("packages", { categoryId: GYM_A_CATEGORY.id, name: "New Pkg", packageType: "membership", sessionAllowanceType: "unlimited" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Package created.");
    expect(h.saveMembershipPackage).toHaveBeenCalledWith(expect.objectContaining({ categoryId: GYM_A_CATEGORY.id }));
  });

  it("denies creating an ordinary package under a cross-gym category, using the existing category response", async () => {
    const res = await post("packages", { categoryId: GYM_B_CATEGORY.id, name: "New Pkg", packageType: "membership", sessionAllowanceType: "unlimited" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("A valid category is required.");
    expect(h.saveMembershipPackage).not.toHaveBeenCalled();
  });

  it("allows same-gym staff to update an ordinary package", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));

    const res = await post("packages", { id: "pkg-a", categoryId: GYM_A_CATEGORY.id, name: "Renamed", packageType: "membership", sessionAllowanceType: "unlimited" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Package updated.");
  });

  it("denies a cross-gym staff member updating an ordinary package, identically to a missing package", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));
    const crossGymRes = await post("packages", { id: "pkg-a", categoryId: GYM_A_CATEGORY.id, name: "Hijacked", packageType: "membership", sessionAllowanceType: "unlimited" }, GYM_B_STAFF.id);
    const crossGymData = await crossGymRes.json();

    h.findMembershipPackageById.mockReturnValue(undefined);
    const missingRes = await post("packages", { id: "does-not-exist", categoryId: GYM_A_CATEGORY.id, name: "X", packageType: "membership", sessionAllowanceType: "unlimited" }, GYM_A_STAFF.id);
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(h.saveMembershipPackage).not.toHaveBeenCalled();
  });

  it("fails closed when the target category is missing", async () => {
    const res = await post("packages", { categoryId: "does-not-exist", name: "X", packageType: "membership", sessionAllowanceType: "unlimited" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("A valid category is required.");
    expect(h.saveMembershipPackage).not.toHaveBeenCalled();
  });

  it("allows any gym's staff to update the global app-only package", async () => {
    h.findMembershipPackageById.mockReturnValue(appOnlyPackage("app-pkg", GYM_A_CATEGORY.id));

    const res = await post(
      "packages",
      { id: "app-pkg", categoryId: GYM_A_CATEGORY.id, name: "App Subscription", packageType: "membership", sessionAllowanceType: "unlimited", deliveryChannel: "app_only" },
      GYM_B_STAFF.id
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Package updated.");
    expect(h.saveMembershipPackage).toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId — no such field is ever persisted or trusted", async () => {
    await post("packages", { categoryId: GYM_A_CATEGORY.id, name: "New Pkg", packageType: "membership", sessionAllowanceType: "unlimited", gymId: "attacker-gym" }, GYM_A_STAFF.id);

    const saved = h.saveMembershipPackage.mock.calls[0]?.[0];
    expect(saved).toBeDefined();
    expect(saved.gymId).toBeUndefined();
  });

  it("rejects an update that would change deliveryChannel into app_only, rather than inventing a transition policy", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id, { deliveryChannel: "in_person" }));

    const res = await post(
      "packages",
      { id: "pkg-a", categoryId: GYM_A_CATEGORY.id, name: "Pkg", packageType: "membership", sessionAllowanceType: "unlimited", deliveryChannel: "app_only" },
      GYM_A_STAFF.id
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("Changing a package's delivery channel to or from App-only isn't supported yet.");
    expect(h.saveMembershipPackage).not.toHaveBeenCalled();
  });

  it("rejects an update that would change deliveryChannel out of app_only", async () => {
    h.findMembershipPackageById.mockReturnValue(appOnlyPackage("app-pkg", GYM_A_CATEGORY.id));

    const res = await post(
      "packages",
      { id: "app-pkg", categoryId: GYM_A_CATEGORY.id, name: "App Subscription", packageType: "membership", sessionAllowanceType: "unlimited", deliveryChannel: "in_person" },
      GYM_A_STAFF.id
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("Changing a package's delivery channel to or from App-only isn't supported yet.");
    expect(h.saveMembershipPackage).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post("packages", { categoryId: GYM_A_CATEGORY.id, name: "X", packageType: "membership", sessionAllowanceType: "unlimited" });
    expect(res.status).toBe(401);
    expect(h.saveMembershipPackage).not.toHaveBeenCalled();
  });

  it("rejects a role without catalog.manage (coach)", async () => {
    const res = await post("packages", { categoryId: GYM_A_CATEGORY.id, name: "X", packageType: "membership", sessionAllowanceType: "unlimited" }, GYM_A_COACH.id);
    expect(res.status).toBe(403);
    expect(h.saveMembershipPackage).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/catalog/packages/delete", () => {
  it("allows same-gym staff to delete an ordinary package", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));

    const res = await post("packages/delete", { id: "pkg-a" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(h.deleteMembershipPackage).toHaveBeenCalledWith("pkg-a");
  });

  it("denies a cross-gym staff member deleting an ordinary package, identically to a missing package", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));
    const crossGymRes = await post("packages/delete", { id: "pkg-a" }, GYM_B_STAFF.id);
    const crossGymData = await crossGymRes.json();

    h.findMembershipPackageById.mockReturnValue(undefined);
    const missingRes = await post("packages/delete", { id: "does-not-exist" }, GYM_A_STAFF.id);
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(h.deleteMembershipPackage).not.toHaveBeenCalled();
    expect(h.countBillingOptionsByPackageId).not.toHaveBeenCalled();
  });

  it("allows any gym's staff to delete-guard-check the global app-only package", async () => {
    h.findMembershipPackageById.mockReturnValue(appOnlyPackage("app-pkg", GYM_A_CATEGORY.id));

    const res = await post("packages/delete", { id: "app-pkg" }, GYM_B_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(h.deleteMembershipPackage).toHaveBeenCalledWith("app-pkg");
  });

  it("fails closed for a missing package", async () => {
    h.findMembershipPackageById.mockReturnValue(undefined);

    const res = await post("packages/delete", { id: "does-not-exist" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("This package no longer exists.");
    expect(h.deleteMembershipPackage).not.toHaveBeenCalled();
  });

  it("preserves the existing in-use guards for a same-gym package", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));
    h.countBillingOptionsByPackageId.mockReturnValue(3);

    const res = await post("packages/delete", { id: "pkg-a" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toContain("3 billing options");
    expect(h.deleteMembershipPackage).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post("packages/delete", { id: "pkg-a" });
    expect(res.status).toBe(401);
    expect(h.deleteMembershipPackage).not.toHaveBeenCalled();
  });

  it("rejects a role without catalog.manage (coach)", async () => {
    const res = await post("packages/delete", { id: "pkg-a" }, GYM_A_COACH.id);
    expect(res.status).toBe(403);
    expect(h.deleteMembershipPackage).not.toHaveBeenCalled();
  });
});
