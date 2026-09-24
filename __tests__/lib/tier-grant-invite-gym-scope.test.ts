// Gym isolation for Membership-tier grants and invite redemption.
//
// 1. lib/tier-grant.ts grantMemberTier(userId, "membership"): the package a
//    member is granted must belong to the RECEIVING member's gym (package ->
//    categoryId -> category.gymId; gymId null = primary gym, lib/gym-scope.ts).
//    Before, the default pick was the lowest-sortOrder non-app-only package of
//    ANY gym, and an explicitly requested packageId was never ownership-checked
//    — so a gym could grant another gym's package. Now the default is chosen
//    among the member's own gym's packages, a foreign packageId reads exactly
//    like an invalid one, and nothing is saved. Free / App Subscription grants
//    (the platform-wide app-only package) are unchanged.
// 2. POST /api/invites/redeem (existing account): an invite issued by another
//    gym's staff cannot be redeemed against a member of a different gym — it
//    reads like an invalid link and grants nothing. Same-gym redemption is
//    unchanged. (Signup-time redemption, where the new account has no gym yet,
//    is a pending product decision and is not touched.)
//
// Auth uses the real signed-session mechanism; sameGym / sameGymAsStaff are
// deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findMembershipCategories: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findMembershipPackages: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  saveSubscription: vi.fn(),
  findInviteByToken: vi.fn(),
  redeemInvite: vi.fn(),
  cancelProviderSubscription: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/billing", () => ({ cancelProviderSubscription: h.cancelProviderSubscription }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveMemberTier: () => "membership" }));

type U = { id: string; email: string; role: string; gymId: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId });

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const STAFF_A = user("staff-a", "admin", null);
const STAFF_B = user("staff-b", "admin", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const EVERYONE = [STAFF_A, STAFF_B, MEMBER_A, MEMBER_B];

const CATEGORIES = [
  { id: "cat-a", gymId: null },
  { id: "cat-b", gymId: "gym-b" },
];
const pkg = (id: string, categoryId: string, sortOrder: number, deliveryChannel = "in_person") => ({
  id,
  categoryId,
  sortOrder,
  deliveryChannel,
  slug: id,
});
// Gym B's package sorts FIRST platform-wide: the old default pick would have chosen it for everyone.
const PACKAGES = [
  pkg("pkg-b-first", "cat-b", 0),
  pkg("pkg-a-default", "cat-a", 1),
  pkg("pkg-a-second", "cat-a", 2),
  pkg("pkg-b-second", "cat-b", 3),
  pkg("pkg-orphan", "cat-gone", -1),
  pkg("pkg-app", "cat-b", -2, "app_only"),
];

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  h.findMembershipCategories.mockImplementation(() => CATEGORIES);
  h.findMembershipPackages.mockImplementation(() => PACKAGES);
  h.findMembershipPackageById.mockImplementation((id: string) => PACKAGES.find((p) => p.id === id));
  h.findSubscriptionByUserId.mockReturnValue(undefined);
});

const savedPackageId = () => h.saveSubscription.mock.calls[0]?.[0]?.packageId;

describe("grantMemberTier — membership package is chosen inside the member's gym", () => {
  it("default pick: a gym A member gets gym A's lowest-sortOrder package, never gym B's", async () => {
    const { grantMemberTier } = await import("@/lib/tier-grant");

    const result = await grantMemberTier(MEMBER_A.id, "membership");

    expect(result.ok).toBe(true);
    expect(savedPackageId()).toBe("pkg-a-default");
  });

  it("default pick: a gym B member gets gym B's package", async () => {
    const { grantMemberTier } = await import("@/lib/tier-grant");

    await grantMemberTier(MEMBER_B.id, "membership");

    expect(savedPackageId()).toBe("pkg-b-first");
  });

  it("a gym with no packages fails closed rather than borrowing another gym's", async () => {
    h.findMembershipPackages.mockReturnValue(PACKAGES.filter((p) => p.categoryId === "cat-b"));
    const { grantMemberTier } = await import("@/lib/tier-grant");

    const result = await grantMemberTier(MEMBER_A.id, "membership");

    expect(result).toEqual({ ok: false, message: "No Membership-tier package exists to assign." });
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("an explicit same-gym packageId is accepted", async () => {
    const { grantMemberTier } = await import("@/lib/tier-grant");

    const result = await grantMemberTier(MEMBER_A.id, "membership", { packageId: "pkg-a-second" });

    expect(result.ok).toBe(true);
    expect(savedPackageId()).toBe("pkg-a-second");
  });

  it("an explicit packageId from another gym is rejected exactly like an invalid one, saving nothing (both directions)", async () => {
    const { grantMemberTier } = await import("@/lib/tier-grant");
    const invalid = await grantMemberTier(MEMBER_A.id, "membership", { packageId: "pkg-does-not-exist" });

    const crossGym = await grantMemberTier(MEMBER_A.id, "membership", { packageId: "pkg-b-first" });
    const reverse = await grantMemberTier(MEMBER_B.id, "membership", { packageId: "pkg-a-default" });

    expect(crossGym).toEqual(invalid);
    expect(reverse).toEqual(invalid);
    expect(invalid).toEqual({ ok: false, message: "That package isn't a Membership-tier package." });
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("a package whose category can't be resolved fails closed, and app-only stays rejected here (existing)", async () => {
    const { grantMemberTier } = await import("@/lib/tier-grant");

    expect((await grantMemberTier(MEMBER_A.id, "membership", { packageId: "pkg-orphan" })).ok).toBe(false);
    expect((await grantMemberTier(MEMBER_A.id, "membership", { packageId: "pkg-app" })).ok).toBe(false);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("an unresolvable member is refused before anything is saved", async () => {
    const { grantMemberTier } = await import("@/lib/tier-grant");

    const result = await grantMemberTier("member-gone", "membership");

    expect(result).toEqual({ ok: false, message: "Member not found." });
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("leaves the App Subscription and Free grants unchanged (platform-wide app-only package)", async () => {
    h.findMembershipPackages.mockReturnValue([{ ...pkg("pkg-app", "cat-b", 0, "app_only"), slug: "app-subscription-tier-2" }]);
    const { grantMemberTier } = await import("@/lib/tier-grant");

    const app = await grantMemberTier(MEMBER_A.id, "app_subscription");
    expect(app.ok).toBe(true);
    expect(savedPackageId()).toBe("pkg-app");

    h.saveSubscription.mockClear();
    h.findSubscriptionByUserId.mockReturnValue({ userId: MEMBER_A.id, status: "active", packageId: "pkg-a-default", provider: "none" });
    const free = await grantMemberTier(MEMBER_A.id, "free");
    expect(free.ok).toBe(true);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled" }));
  });
});

describe("POST /api/invites/redeem — inviter's gym must match the member's gym", () => {
  const invite = (invitedByStaffId: string) => ({
    id: "inv-1",
    email: "member-a@x.test",
    tier: "membership" as const,
    tokenHash: "h",
    status: "pending" as const,
    invitedByStaffId,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    redeemedAt: null,
    redeemedByUserId: null,
  });
  const redeem = async (token: unknown, u?: U, extra: Record<string, unknown> = {}) => {
    const { POST } = await import("@/app/api/invites/redeem/route");
    return POST(
      new NextRequest("http://localhost/api/invites/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(u ? { Cookie: `session=${signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS)}` } : {}),
        },
        body: JSON.stringify({ token, ...extra }),
      })
    );
  };
  const INVALID = { success: false, message: "This invite link isn't valid." };

  it("redeems a same-gym invite (existing behavior): tier granted from the member's gym, invite consumed", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_A.id));
    h.redeemInvite.mockReturnValue({ ...invite(STAFF_A.id), status: "redeemed" });

    const res = await redeem("tok", MEMBER_A);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Invite redeemed — welcome!", data: { tier: "membership" } });
    expect(savedPackageId()).toBe("pkg-a-default");
    expect(h.redeemInvite).toHaveBeenCalledWith("inv-1", MEMBER_A.id);
  });

  it("rejects an invite from another gym's staff exactly like an invalid link, granting and consuming nothing", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));

    const res = await redeem("tok", MEMBER_A);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID);
    expect(h.saveSubscription).not.toHaveBeenCalled();
    expect(h.redeemInvite).not.toHaveBeenCalled();

    h.findInviteByToken.mockReturnValue(undefined);
    const missing = await redeem("nope", MEMBER_A);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual(INVALID);
  });

  it("fails closed when the inviting staff account can't be resolved", async () => {
    h.findInviteByToken.mockReturnValue(invite("staff-gone"));

    const res = await redeem("tok", MEMBER_A);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId", async () => {
    h.findInviteByToken.mockReturnValue(invite(STAFF_B.id));

    const res = await redeem("tok", MEMBER_A, { gymId: "gym-b" });

    expect(res.status).toBe(400);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("keeps 401 and validation unchanged", async () => {
    const anon = await redeem("tok");
    expect(anon.status).toBe(401);
    expect((await anon.json()).requiresAuth).toBe(true);

    const noToken = await redeem("", MEMBER_A);
    expect(noToken.status).toBe(400);
    expect((await noToken.json()).message).toBe("An invite token is required.");

    expect(h.findInviteByToken).not.toHaveBeenCalled();
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });
});
