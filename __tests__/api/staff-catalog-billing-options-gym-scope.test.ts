// Cross-gym isolation test for
// app/api/staff/catalog/billing-options/route.ts (create/update) and
// app/api/staff/catalog/billing-options/delete/route.ts. A billing
// option's gym resolves via packageId -> package.categoryId ->
// category.gymId. An option under a deliveryChannel: "app_only" package
// inherits that package's global-access exception.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findMembershipCategoryById: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findMembershipBillingOptionById: vi.fn(),
  saveMembershipBillingOption: vi.fn(),
  deleteMembershipBillingOption: vi.fn(),
  findAllSubscriptions: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const GYM_B_STAFF = { id: "staff-b", email: "staffb@x.test", role: "admin" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };

const GYM_A_CATEGORY = { id: "cat-a", gymId: null, name: "Cat A", slug: "cat-a", description: null, sortOrder: 0, visible: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const GYM_B_CATEGORY = { ...GYM_A_CATEGORY, id: "cat-b", gymId: "gym-b" };

function ordinaryPackage(id: string, categoryId: string) {
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
  };
}

function appOnlyPackage(id: string, categoryId: string) {
  return { ...ordinaryPackage(id, categoryId), deliveryChannel: "app_only", billingChannel: "google_play" };
}

function option(id: string, packageId: string) {
  return {
    id,
    packageId,
    name: "Monthly",
    billingType: "recurring",
    intervalUnit: "month",
    intervalCount: 1,
    amountCents: 5000,
    currency: "eur",
    visible: true,
    sortOrder: 0,
    stripePriceId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function post(path: "billing-options" | "billing-options/delete", body: unknown, sessionUserId?: string) {
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
  h.findAllSubscriptions.mockReturnValue([]);
});

describe("POST /api/staff/catalog/billing-options (create/update)", () => {
  const validPayload = { name: "Monthly", billingType: "recurring", intervalUnit: "month", intervalCount: 1, priceEur: "50.00" };

  it("creates an option under a same-gym ordinary package", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));

    const res = await post("billing-options", { ...validPayload, packageId: "pkg-a" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Billing option created.");
    expect(h.saveMembershipBillingOption).toHaveBeenCalledWith(expect.objectContaining({ packageId: "pkg-a" }));
  });

  it("denies creating an option under a cross-gym ordinary package, using the existing package response", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));

    const res = await post("billing-options", { ...validPayload, packageId: "pkg-a" }, GYM_B_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("A valid package is required.");
    expect(h.saveMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("allows any gym's staff to create an option under the global app-only package", async () => {
    h.findMembershipPackageById.mockReturnValue(appOnlyPackage("app-pkg", GYM_A_CATEGORY.id));

    const res = await post("billing-options", { ...validPayload, packageId: "app-pkg" }, GYM_B_STAFF.id);

    expect(res.status).toBe(200);
    expect(h.saveMembershipBillingOption).toHaveBeenCalled();
  });

  it("fails closed when the target package is missing", async () => {
    h.findMembershipPackageById.mockReturnValue(undefined);

    const res = await post("billing-options", { ...validPayload, packageId: "does-not-exist" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.message).toBe("A valid package is required.");
    expect(h.saveMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("allows same-gym staff to update an existing option on a same-gym package", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));
    h.findMembershipBillingOptionById.mockReturnValue(option("opt-a", "pkg-a"));

    const res = await post("billing-options", { ...validPayload, id: "opt-a", packageId: "pkg-a" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Billing option updated.");
  });

  it("denies a cross-gym staff member updating an existing option, using the same not-found-package response as a missing target package", async () => {
    // Both the existing option AND the requested target packageId are
    // gym A's — Gym B staff fails at the target-package gate first (the
    // same gate a request naming a nonexistent packageId would fail at),
    // never reaching the separate existing-option-ownership gate.
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));
    h.findMembershipBillingOptionById.mockReturnValue(option("opt-a", "pkg-a"));
    const crossGymRes = await post("billing-options", { ...validPayload, id: "opt-a", packageId: "pkg-a" }, GYM_B_STAFF.id);
    const crossGymData = await crossGymRes.json();

    h.findMembershipPackageById.mockReturnValue(undefined);
    const missingRes = await post("billing-options", { ...validPayload, id: "opt-a", packageId: "does-not-exist" }, GYM_A_STAFF.id);
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(400);
    expect(crossGymData.message).toBe("A valid package is required.");
    expect(h.saveMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("denies a cross-gym staff member re-pointing a foreign option into one of their own packages (hijack via packageId reassignment)", async () => {
    // opt-a currently belongs to pkg-a (gym A). Gym B staff owns pkg-b.
    // Submitting an update for opt-a with packageId: pkg-b must still be
    // denied, because the EXISTING option (pkg-a) isn't theirs to move.
    h.findMembershipBillingOptionById.mockReturnValue(option("opt-a", "pkg-a"));
    h.findMembershipPackageById.mockImplementation((id: string) =>
      id === "pkg-a" ? ordinaryPackage("pkg-a", GYM_A_CATEGORY.id) : id === "pkg-b" ? ordinaryPackage("pkg-b", GYM_B_CATEGORY.id) : undefined
    );

    const res = await post("billing-options", { ...validPayload, id: "opt-a", packageId: "pkg-b" }, GYM_B_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("This billing option no longer exists.");
    expect(h.saveMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));

    await post("billing-options", { ...validPayload, packageId: "pkg-a", gymId: "attacker-gym" }, GYM_A_STAFF.id);

    const saved = h.saveMembershipBillingOption.mock.calls[0]?.[0];
    expect(saved).toBeDefined();
    expect(saved.gymId).toBeUndefined();
  });

  it("preserves existing validation (price required)", async () => {
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));

    const res = await post("billing-options", { packageId: "pkg-a", name: "Monthly", billingType: "recurring" }, GYM_A_STAFF.id);
    expect(res.status).toBe(400);
    expect(h.saveMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post("billing-options", { ...validPayload, packageId: "pkg-a" });
    expect(res.status).toBe(401);
    expect(h.saveMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("rejects a role without catalog.manage (coach)", async () => {
    const res = await post("billing-options", { ...validPayload, packageId: "pkg-a" }, GYM_A_COACH.id);
    expect(res.status).toBe(403);
    expect(h.saveMembershipBillingOption).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/catalog/billing-options/delete", () => {
  it("allows same-gym staff to delete an option on a same-gym package", async () => {
    h.findMembershipBillingOptionById.mockReturnValue(option("opt-a", "pkg-a"));
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));

    const res = await post("billing-options/delete", { id: "opt-a" }, GYM_A_STAFF.id);

    expect(res.status).toBe(200);
    expect(h.deleteMembershipBillingOption).toHaveBeenCalledWith("opt-a");
  });

  it("denies a cross-gym staff member deleting an option, identically to a missing option", async () => {
    h.findMembershipBillingOptionById.mockReturnValue(option("opt-a", "pkg-a"));
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));
    const crossGymRes = await post("billing-options/delete", { id: "opt-a" }, GYM_B_STAFF.id);
    const crossGymData = await crossGymRes.json();

    h.findMembershipBillingOptionById.mockReturnValue(undefined);
    const missingRes = await post("billing-options/delete", { id: "does-not-exist" }, GYM_A_STAFF.id);
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(h.deleteMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("allows any gym's staff to delete an option on the global app-only package", async () => {
    h.findMembershipBillingOptionById.mockReturnValue(option("opt-a", "app-pkg"));
    h.findMembershipPackageById.mockReturnValue(appOnlyPackage("app-pkg", GYM_A_CATEGORY.id));

    const res = await post("billing-options/delete", { id: "opt-a" }, GYM_B_STAFF.id);
    expect(res.status).toBe(200);
    expect(h.deleteMembershipBillingOption).toHaveBeenCalledWith("opt-a");
  });

  it("fails closed when the parent package is missing", async () => {
    h.findMembershipBillingOptionById.mockReturnValue(option("opt-a", "does-not-exist"));
    h.findMembershipPackageById.mockReturnValue(undefined);

    const res = await post("billing-options/delete", { id: "opt-a" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("This billing option no longer exists.");
    expect(h.deleteMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("preserves the existing in-use guard for a same-gym option", async () => {
    h.findMembershipBillingOptionById.mockReturnValue(option("opt-a", "pkg-a"));
    h.findMembershipPackageById.mockReturnValue(ordinaryPackage("pkg-a", GYM_A_CATEGORY.id));
    h.findAllSubscriptions.mockReturnValue([{ billingOptionId: "opt-a" }]);

    const res = await post("billing-options/delete", { id: "opt-a" }, GYM_A_STAFF.id);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.message).toContain("1 membership");
    expect(h.deleteMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post("billing-options/delete", { id: "opt-a" });
    expect(res.status).toBe(401);
    expect(h.deleteMembershipBillingOption).not.toHaveBeenCalled();
  });

  it("rejects a role without catalog.manage (coach)", async () => {
    const res = await post("billing-options/delete", { id: "opt-a" }, GYM_A_COACH.id);
    expect(res.status).toBe(403);
    expect(h.deleteMembershipBillingOption).not.toHaveBeenCalled();
  });
});
