// Gym isolation for app/api/admin/membership/activate/route.ts (legacy admin
// activation). Two independent gates, both against the ACTING admin's gym:
//   1. the TARGET MEMBER must be in the admin's gym (cross-gym is folded into
//      the existing "Member not found." 404, before role/package/date
//      handling and before any save);
//   2. the PACKAGE must resolve packageId -> package -> category -> gymId and
//      belong to that gym, with deliveryChannel === "app_only" as the sole
//      global exception — which applies to the package gate only, never the
//      target-member gate.
// Auth uses the real signed-session mechanism; sameGym,
// staffAuthorizedForCatalogPackage and can() are deliberately not mocked.
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

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const GYM_A_ADMIN = { id: "admin-a", email: "admina@x.test", role: "admin" as const, gymId: null, archivedAt: null };
const GYM_B_ADMIN = { id: "admin-b", email: "adminb@x.test", role: "admin" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_COACH = { id: "coach-a", email: "coacha@x.test", role: "coach" as const, gymId: null, archivedAt: null };
const GYM_B_COACH = { id: "coach-b", email: "coachb@x.test", role: "coach" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const GYM_A_CATEGORY = { id: "cat-a", gymId: null };
const GYM_B_CATEGORY = { id: "cat-b", gymId: "gym-b" };

function pkg(id: string, categoryId: string, overrides: Record<string, unknown> = {}) {
  return { id, categoryId, name: `Package ${id}`, slug: id, visible: true, deliveryChannel: "in_person", billingChannel: "stripe_web", ...overrides };
}

async function post(body: unknown, sessionUserId?: string) {
  const mod = await import("@/app/api/admin/membership/activate/route");
  const req = new NextRequest("http://localhost/api/admin/membership/activate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  return mod.POST(req);
}

const activate = (packageId: string, sessionUserId: string = GYM_A_ADMIN.id, userId: string = GYM_A_MEMBER.id) =>
  post({ userId, packageId }, sessionUserId);

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_ADMIN, GYM_B_ADMIN, GYM_A_COACH, GYM_B_COACH, GYM_A_MEMBER, GYM_B_MEMBER].find((u) => u.id === id)
  );
  h.findMembershipCategoryById.mockImplementation((id: string) =>
    [GYM_A_CATEGORY, GYM_B_CATEGORY].find((c) => c.id === id)
  );
  h.findMembershipPackageById.mockImplementation((id: string) =>
    id === "pkg-a" ? pkg("pkg-a", "cat-a") : id === "pkg-b" ? pkg("pkg-b", "cat-b") : undefined
  );
  h.findSubscriptionByUserId.mockReturnValue(undefined);
});

describe("POST /api/admin/membership/activate — package ownership", () => {
  it("activates a same-gym ordinary package with the existing response and persistence", async () => {
    const res = await activate("pkg-a");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: `${GYM_A_MEMBER.email} activated on Package pkg-a. Session count reset to 0.`,
    });
    expect(h.findMembershipCategoryById).toHaveBeenCalledWith("cat-a");
    expect(h.saveSubscription).toHaveBeenCalledTimes(1);
    expect(h.saveSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: GYM_A_MEMBER.id,
        packageId: "pkg-a",
        billingOptionId: null,
        status: "active",
        provider: "none",
        sessionsUsedThisPeriod: 0,
        currentPeriodEnd: null,
      })
    );
  });

  it("persists a valid periodEndIso exactly as before", async () => {
    const res = await post({ userId: GYM_A_MEMBER.id, packageId: "pkg-a", periodEndIso: "2027-01-15T00:00:00.000Z" }, GYM_A_ADMIN.id);

    expect(res.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ currentPeriodEnd: "2027-01-15T00:00:00.000Z" }));
  });

  it("denies a cross-gym ordinary package with the existing not-found response, identical to a missing package", async () => {
    const crossGym = await activate("pkg-b");
    const crossGymBody = await crossGym.json();
    expect(h.saveSubscription).not.toHaveBeenCalled();

    const missing = await activate("pkg-missing");
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(404);
    expect(crossGym.status).toBe(missing.status);
    expect(crossGymBody).toEqual(missingBody);
    expect(crossGymBody.message).toBe("This package does not exist or is not available.");
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("authorizes the package against the acting admin's gym (gym-B admin cannot use a gym-A package, and vice versa)", async () => {
    const bAdminAPackage = await activate("pkg-a", GYM_B_ADMIN.id, GYM_B_MEMBER.id);
    expect(bAdminAPackage.status).toBe(404);
    expect(h.saveSubscription).not.toHaveBeenCalled();

    const bAdminBPackage = await activate("pkg-b", GYM_B_ADMIN.id, GYM_B_MEMBER.id);
    expect(bAdminBPackage.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ userId: GYM_B_MEMBER.id, packageId: "pkg-b" }));
  });

  it("fails closed when the package is missing", async () => {
    const res = await activate("pkg-missing");

    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("This package does not exist or is not available.");
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("fails closed when the package's category is missing", async () => {
    h.findMembershipPackageById.mockReturnValue(pkg("pkg-orphan", "cat-gone"));

    const res = await activate("pkg-orphan");

    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("This package does not exist or is not available.");
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("allows a visible app_only package from any gym's admin, when every other check passes", async () => {
    h.findMembershipPackageById.mockReturnValue(
      pkg("pkg-app", "cat-b", { deliveryChannel: "app_only", billingChannel: "google_play", slug: "app-subscription-tier-2" })
    );

    const res = await activate("pkg-app");

    expect(res.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ packageId: "pkg-app", status: "active" }));
  });

  it("still applies the existing visibility rule to app_only packages (the seeded App Subscription is visible: false, so this route cannot reach it)", async () => {
    h.findMembershipPackageById.mockReturnValue(pkg("pkg-app", "cat-a", { deliveryChannel: "app_only", visible: false }));

    const res = await activate("pkg-app");

    expect(res.status).toBe(404);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("does not treat billingChannel, package slug, hybrid delivery, or a null-gym category as the global exception", async () => {
    // Every package below sits under a gym-b category, activated by gym-A admin.
    for (const overrides of [
      { billingChannel: "manual" },
      { billingChannel: "google_play" },
      { billingChannel: "apple_iap" },
      { slug: "app-subscription-tier-2" },
      { deliveryChannel: "hybrid" },
    ]) {
      h.findMembershipPackageById.mockReturnValue(pkg("pkg-x", "cat-b", overrides));
      const res = await activate("pkg-x");
      expect(res.status).toBe(404);
    }
    expect(h.saveSubscription).not.toHaveBeenCalled();

    // gymId === null on the category is just the primary gym, not "global":
    // a gym-B admin cannot use a package under a null-gym category.
    h.findMembershipPackageById.mockReturnValue(pkg("pkg-null-gym", "cat-a"));
    const res = await activate("pkg-null-gym", GYM_B_ADMIN.id, GYM_B_MEMBER.id);
    expect(res.status).toBe(404);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("preserves the existing hidden-package rule for a same-gym ordinary package", async () => {
    h.findMembershipPackageById.mockReturnValue(pkg("pkg-a", "cat-a", { visible: false }));

    const res = await activate("pkg-a");

    expect(res.status).toBe(404);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("preserves existing request validation without mutating", async () => {
    const missingMember = await activate("pkg-a", GYM_A_ADMIN.id, "member-missing");
    expect(missingMember.status).toBe(404);
    expect((await missingMember.json()).message).toBe("Member not found.");

    const notAMember = await activate("pkg-a", GYM_A_ADMIN.id, GYM_A_COACH.id);
    expect(notAMember.status).toBe(400);

    const noPackage = await post({ userId: GYM_A_MEMBER.id }, GYM_A_ADMIN.id);
    expect(noPackage.status).toBe(400);

    const badDate = await post({ userId: GYM_A_MEMBER.id, packageId: "pkg-a", periodEndIso: "not-a-date" }, GYM_A_ADMIN.id);
    expect(badDate.status).toBe(400);

    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post({ userId: GYM_A_MEMBER.id, packageId: "pkg-a" });

    expect(res.status).toBe(401);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("rejects staff without members.billing (coach)", async () => {
    const res = await activate("pkg-a", GYM_A_COACH.id);

    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("Only staff can activate memberships.");
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });
});

// Target-member gym gate. Admin gym, target-member gym, package gym, and
// app-only status are varied independently below so a pass here can only come
// from the member check itself.
describe("POST /api/admin/membership/activate — target-member gym", () => {
  const APP_ONLY = pkg("pkg-app", "cat-b", { deliveryChannel: "app_only", billingChannel: "google_play" });

  beforeEach(() => {
    h.findMembershipPackageById.mockImplementation((id: string) =>
      id === "pkg-a" ? pkg("pkg-a", "cat-a") : id === "pkg-b" ? pkg("pkg-b", "cat-b") : id === "pkg-app" ? APP_ONLY : undefined
    );
  });

  function expectMemberNotFound(res: Response, body: { success: boolean; message: string }) {
    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, message: "Member not found." });
    expect(h.saveSubscription).not.toHaveBeenCalled();
    // The member gate runs first: no package lookup, category lookup, or
    // existing-subscription read happens for a cross-gym target.
    expect(h.findMembershipPackageById).not.toHaveBeenCalled();
    expect(h.findMembershipCategoryById).not.toHaveBeenCalled();
    expect(h.findSubscriptionByUserId).not.toHaveBeenCalled();
  }

  it("activates a same-gym member for a same-gym admin with the existing response and saveSubscription arguments", async () => {
    const res = await activate("pkg-a", GYM_A_ADMIN.id, GYM_A_MEMBER.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: `${GYM_A_MEMBER.email} activated on Package pkg-a. Session count reset to 0.`,
    });
    expect(h.saveSubscription).toHaveBeenCalledTimes(1);
    expect(h.saveSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GYM_A_MEMBER.id, packageId: "pkg-a", status: "active", provider: "none", sessionsUsedThisPeriod: 0 })
    );
  });

  it("activates a gym-B member for a gym-B admin on a gym-B package (second gym works too)", async () => {
    const res = await activate("pkg-b", GYM_B_ADMIN.id, GYM_B_MEMBER.id);

    expect(res.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ userId: GYM_B_MEMBER.id, packageId: "pkg-b" }));
  });

  it("denies a gym-A admin activating a gym-B member with 404 'Member not found.', identical to a missing member", async () => {
    const crossGym = await activate("pkg-a", GYM_A_ADMIN.id, GYM_B_MEMBER.id);
    const crossGymBody = await crossGym.json();
    expectMemberNotFound(crossGym, crossGymBody);

    const missing = await activate("pkg-a", GYM_A_ADMIN.id, "member-missing");
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(missing.status);
    expect(crossGymBody).toEqual(missingBody);
  });

  it("denies the reverse direction too (gym-B admin, gym-A member)", async () => {
    const res = await activate("pkg-b", GYM_B_ADMIN.id, GYM_A_MEMBER.id);

    expectMemberNotFound(res, await res.json());
  });

  it("denies a cross-gym target at the member gate for every package kind: same-gym-as-admin, app-only, and cross-gym", async () => {
    // Admin A -> member B, varying only the package.
    for (const packageId of ["pkg-a", "pkg-app", "pkg-b"]) {
      vi.clearAllMocks();
      const res = await activate(packageId, GYM_A_ADMIN.id, GYM_B_MEMBER.id);
      expectMemberNotFound(res, await res.json());
    }
  });

  it("does not let the app-only package exception bypass the target-member gate", async () => {
    // Admin B -> member A, app-only package that both gyms can otherwise use.
    const res = await activate("pkg-app", GYM_B_ADMIN.id, GYM_A_MEMBER.id);

    expectMemberNotFound(res, await res.json());

    // Control: the same app-only package works for a same-gym pair.
    const ok = await activate("pkg-app", GYM_B_ADMIN.id, GYM_B_MEMBER.id);
    expect(ok.status).toBe(200);
  });

  it("returns the same 404 for a cross-gym non-member account, without revealing its role", async () => {
    const crossGymCoach = await activate("pkg-a", GYM_A_ADMIN.id, GYM_B_COACH.id);
    expectMemberNotFound(crossGymCoach, await crossGymCoach.json());
  });

  it("runs the member gate before date validation (an invalid periodEndIso on a cross-gym target is still 404)", async () => {
    const res = await post(
      { userId: GYM_B_MEMBER.id, packageId: "pkg-a", periodEndIso: "not-a-date" },
      GYM_A_ADMIN.id
    );

    expectMemberNotFound(res, await res.json());
  });

  it("returns the existing 404 for a missing member, with no mutation", async () => {
    const res = await activate("pkg-a", GYM_A_ADMIN.id, "member-missing");

    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("Member not found.");
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("preserves the existing member-role rejection for a same-gym non-member target, with no mutation", async () => {
    const res = await activate("pkg-a", GYM_A_ADMIN.id, GYM_A_COACH.id);

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Can only activate memberships for member accounts.");
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("still enforces the package gate after the member gate passes (same-gym member, cross-gym package)", async () => {
    const res = await activate("pkg-b", GYM_A_ADMIN.id, GYM_A_MEMBER.id);

    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("This package does not exist or is not available.");
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request before either gate", async () => {
    const res = await post({ userId: GYM_B_MEMBER.id, packageId: "pkg-a" });

    expect(res.status).toBe(401);
    expect(h.findUserById).not.toHaveBeenCalled();
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("rejects staff without members.billing before either gate, even for a cross-gym target", async () => {
    const res = await activate("pkg-a", GYM_A_COACH.id, GYM_B_MEMBER.id);

    expect(res.status).toBe(403);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });
});
