// Package-ownership isolation for
// app/api/staff/members/[userId]/subscription/route.ts. The route already
// gym-scopes the TARGET MEMBER (covered in staff-members-gym-scope.test.ts);
// these tests cover the package: it must resolve packageId -> package ->
// category -> gymId and belong to the GRANTING STAFF MEMBER's gym, with
// deliveryChannel === "app_only" as the sole global exception. Auth uses the
// real signed-session mechanism; sameGym, staffAuthorizedForCatalogPackage
// and can() are deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findMembershipCategoryById: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  saveSubscription: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const { mockCancelProviderSubscription } = vi.hoisted(() => ({
  mockCancelProviderSubscription: vi.fn(),
}));
vi.mock("@/lib/billing", () => ({ cancelProviderSubscription: mockCancelProviderSubscription }));

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const GYM_B_STAFF = { id: "staff-b", email: "staffb@x.test", role: "admin" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const GYM_A_CATEGORY = { id: "cat-a", gymId: null };
const GYM_B_CATEGORY = { id: "cat-b", gymId: "gym-b" };

function pkg(id: string, categoryId: string, overrides: Record<string, unknown> = {}) {
  return { id, categoryId, name: id, slug: id, deliveryChannel: "in_person", billingChannel: "stripe_web", ...overrides };
}

const STRIPE_SUBSCRIPTION = {
  userId: GYM_A_MEMBER.id,
  packageId: "pkg-old",
  billingOptionId: null,
  status: "active",
  provider: "stripe",
  providerSubscriptionId: "sub_live",
  sessionsUsedThisPeriod: 2,
  extraSessionGrants: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SUCCESS_BODY = { success: true, message: "Membership status updated.", warning: null };

async function post(userId: string, body: unknown, sessionUserId?: string) {
  const mod = await import("@/app/api/staff/members/[userId]/subscription/route");
  const req = new NextRequest(`http://localhost/api/staff/members/${userId}/subscription`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  return mod.POST(req, { params: Promise.resolve({ userId }) });
}

function expectNoMutation() {
  expect(h.saveSubscription).not.toHaveBeenCalled();
  expect(mockCancelProviderSubscription).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_STAFF, GYM_B_STAFF, GYM_A_COACH, GYM_A_MEMBER, GYM_B_MEMBER].find((u) => u.id === id)
  );
  h.findMembershipCategoryById.mockImplementation((id: string) =>
    [GYM_A_CATEGORY, GYM_B_CATEGORY].find((c) => c.id === id)
  );
  h.findMembershipPackageById.mockImplementation((id: string) =>
    id === "pkg-a" ? pkg("pkg-a", "cat-a") : id === "pkg-b" ? pkg("pkg-b", "cat-b") : undefined
  );
  h.findSubscriptionByUserId.mockReturnValue(undefined);
  mockCancelProviderSubscription.mockResolvedValue({ ok: true });
});

describe("POST /api/staff/members/[userId]/subscription — package ownership", () => {
  it("assigns a same-gym ordinary package, with the existing response shape and persistence", async () => {
    const res = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-a" }, GYM_A_STAFF.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUCCESS_BODY);
    expect(h.findMembershipCategoryById).toHaveBeenCalledWith("cat-a");
    expect(h.saveSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GYM_A_MEMBER.id, packageId: "pkg-a", status: "active", provider: "none" })
    );
  });

  it("denies a cross-gym ordinary package with the existing not-found response, identical to a missing package", async () => {
    const crossGym = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-b" }, GYM_A_STAFF.id);
    const crossGymBody = await crossGym.json();
    expectNoMutation();

    const missing = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-missing" }, GYM_A_STAFF.id);
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(404);
    expect(crossGym.status).toBe(missing.status);
    expect(crossGymBody).toEqual(missingBody);
    expect(crossGymBody.message).toBe("This package does not exist.");
  });

  it("authorizes the package against the STAFF member's gym, not the target member's", async () => {
    // Staff B and member B are both gym B, but pkg-a belongs to gym A.
    const staffBAssignsGymAPackage = await post(GYM_B_MEMBER.id, { status: "active", packageId: "pkg-a" }, GYM_B_STAFF.id);
    expect(staffBAssignsGymAPackage.status).toBe(404);
    expectNoMutation();

    // Control: staff B can assign gym B's own package to gym B's member.
    const ok = await post(GYM_B_MEMBER.id, { status: "active", packageId: "pkg-b" }, GYM_B_STAFF.id);
    expect(ok.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ userId: GYM_B_MEMBER.id, packageId: "pkg-b" }));
  });

  it("fails closed when the package is missing", async () => {
    const res = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-missing" }, GYM_A_STAFF.id);

    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("This package does not exist.");
    expectNoMutation();
  });

  it("fails closed when the package's category is missing", async () => {
    h.findMembershipPackageById.mockReturnValue(pkg("pkg-orphan", "cat-gone"));

    const res = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-orphan" }, GYM_A_STAFF.id);

    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("This package does not exist.");
    expectNoMutation();
  });

  it("allows the global app_only package from any gym's staff, when every other check passes", async () => {
    h.findMembershipPackageById.mockReturnValue(
      pkg("pkg-app", "cat-b", { deliveryChannel: "app_only", billingChannel: "google_play", slug: "app-subscription-tier-2" })
    );

    const res = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-app" }, GYM_A_STAFF.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUCCESS_BODY);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ packageId: "pkg-app" }));
  });

  it("does not treat billingChannel, package slug, or a null-gym category as the global exception", async () => {
    // Every package below sits under a gym-b category, assigned by gym-A staff.
    h.findMembershipCategoryById.mockReturnValue(GYM_B_CATEGORY);
    for (const overrides of [
      { billingChannel: "manual" },
      { billingChannel: "google_play" },
      { billingChannel: "apple_iap" },
      { slug: "app-subscription-tier-2" },
      { deliveryChannel: "hybrid" },
    ]) {
      h.findMembershipPackageById.mockReturnValue(pkg("pkg-x", "cat-b", overrides));
      const res = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-x" }, GYM_A_STAFF.id);
      expect(res.status).toBe(404);
    }
    expectNoMutation();

    // gymId === null on the category is just the primary gym, not "global":
    // gym-B staff cannot assign a package under a null-gym category.
    h.findMembershipCategoryById.mockReturnValue(GYM_A_CATEGORY);
    h.findMembershipPackageById.mockReturnValue(pkg("pkg-null-gym", "cat-a"));
    const res = await post(GYM_B_MEMBER.id, { status: "active", packageId: "pkg-null-gym" }, GYM_B_STAFF.id);
    expect(res.status).toBe(404);
    expectNoMutation();
  });

  it("authorizes the package that will actually be persisted when packageId is omitted (existing subscription's package)", async () => {
    h.findSubscriptionByUserId.mockReturnValue({ ...STRIPE_SUBSCRIPTION, provider: "none", packageId: "pkg-b" });

    const denied = await post(GYM_A_MEMBER.id, { status: "canceled" }, GYM_A_STAFF.id);
    expect(denied.status).toBe(404);
    expectNoMutation();

    h.findSubscriptionByUserId.mockReturnValue({ ...STRIPE_SUBSCRIPTION, provider: "none", packageId: "pkg-a" });
    const allowed = await post(GYM_A_MEMBER.id, { status: "canceled" }, GYM_A_STAFF.id);
    expect(allowed.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ packageId: "pkg-a", status: "canceled" }));
  });

  it("runs the package check before the live-Stripe cancel and before saveSubscription", async () => {
    h.findSubscriptionByUserId.mockReturnValue(STRIPE_SUBSCRIPTION);

    const denied = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-b" }, GYM_A_STAFF.id);
    expect(denied.status).toBe(404);
    expectNoMutation();

    // Control: an authorized package on the same member does cancel Stripe, then save.
    const allowed = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-a" }, GYM_A_STAFF.id);
    expect(allowed.status).toBe(200);
    expect(mockCancelProviderSubscription).toHaveBeenCalledWith({ provider: "stripe", providerSubscriptionId: "sub_live" });
    expect(h.saveSubscription).toHaveBeenCalled();
  });

  it("preserves the existing target-member denial for a member outside the staff member's gym", async () => {
    const res = await post(GYM_B_MEMBER.id, { status: "active", packageId: "pkg-a" }, GYM_A_STAFF.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.findMembershipPackageById).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("preserves existing request validation (invalid status) without mutating", async () => {
    const res = await post(GYM_A_MEMBER.id, { status: "bogus", packageId: "pkg-a" }, GYM_A_STAFF.id);

    expect(res.status).toBe(400);
    expectNoMutation();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-a" });

    expect(res.status).toBe(401);
    expectNoMutation();
  });

  it("rejects staff without members.billing (coach)", async () => {
    const res = await post(GYM_A_MEMBER.id, { status: "active", packageId: "pkg-a" }, GYM_A_COACH.id);

    expect(res.status).toBe(403);
    expectNoMutation();
  });
});
