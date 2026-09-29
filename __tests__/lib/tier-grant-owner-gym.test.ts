// lib/tier-grant.ts's grantMemberTier — SubscriptionRecord.ownerGym stamping.
// Immutable historical provenance: stamped exactly once, the first time a
// user ever gets a subscription row, then preserved unchanged across every
// later tier change (membership <-> app_subscription <-> free) — see
// SubscriptionRecord.ownerGym's own "known open question" comment in
// lib/db.ts for why a cross-type change is deliberately NOT reflected here.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMembershipCategories: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findMembershipPackages: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  saveSubscription: vi.fn(),
  cancelProviderSubscription: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/billing", () => ({ cancelProviderSubscription: h.cancelProviderSubscription }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveMemberTier: () => "membership" }));

import { grantMemberTier } from "@/lib/tier-grant";

const MEMBER_A = { id: "member-a", email: "a@x.test", role: "member", gymId: null };
const MEMBER_B = { id: "member-b", email: "b@x.test", role: "member", gymId: "gym-b" };

const CATEGORIES = [
  { id: "cat-a", gymId: null },
  { id: "cat-b", gymId: "gym-b" },
];
const PKG_A = { id: "pkg-a", categoryId: "cat-a", deliveryChannel: "in_person", sortOrder: 0, slug: "pkg-a" };
const PKG_B = { id: "pkg-b", categoryId: "cat-b", deliveryChannel: "in_person", sortOrder: 0, slug: "pkg-b" };
const PKG_APP = { id: "pkg-app", categoryId: "cat-a", deliveryChannel: "app_only", sortOrder: -1, slug: "app-subscription-tier-2" };
const ALL_PACKAGES = [PKG_A, PKG_B, PKG_APP];

beforeEach(() => {
  vi.clearAllMocks();
  h.findMembershipCategories.mockReturnValue(CATEGORIES);
  h.findMembershipPackages.mockReturnValue(ALL_PACKAGES);
  h.findMembershipPackageById.mockImplementation((id: string) => ALL_PACKAGES.find((p) => p.id === id));
  h.findUserById.mockImplementation((id: string) => [MEMBER_A, MEMBER_B].find((u) => u.id === id));
  h.findSubscriptionByUserId.mockReturnValue(undefined);
  h.cancelProviderSubscription.mockResolvedValue({ ok: true });
});

describe("grantMemberTier — ownerGym", () => {
  it("a brand-new membership grant is stamped with the member's own gym", async () => {
    h.findSubscriptionByUserId.mockReturnValue(undefined);
    await grantMemberTier(MEMBER_B.id, "membership");
    expect(h.saveSubscription.mock.calls[0][0].ownerGym).toEqual({ scope: "gym", gymId: "gym-b" });
  });

  it("a primary-gym (null) member's grant is stamped { scope: 'gym', gymId: null } — not platform", async () => {
    await grantMemberTier(MEMBER_A.id, "membership");
    expect(h.saveSubscription.mock.calls[0][0].ownerGym).toEqual({ scope: "gym", gymId: null });
  });

  it("a brand-new app_subscription grant is stamped { scope: 'platform' }", async () => {
    await grantMemberTier(MEMBER_B.id, "app_subscription");
    expect(h.saveSubscription.mock.calls[0][0].ownerGym).toEqual({ scope: "platform" });
  });

  it("an explicit packageId grant is stamped from that package's own category", async () => {
    await grantMemberTier(MEMBER_B.id, "membership", { packageId: "pkg-b" });
    expect(h.saveSubscription.mock.calls[0][0].ownerGym).toEqual({ scope: "gym", gymId: "gym-b" });
  });

  it("preserves the EXISTING row's ownerGym across a tier change — membership -> app_subscription", async () => {
    h.findSubscriptionByUserId.mockReturnValue({
      userId: MEMBER_B.id, packageId: "pkg-b", status: "active", ownerGym: { scope: "gym", gymId: "gym-b" },
    });
    await grantMemberTier(MEMBER_B.id, "app_subscription");
    // Stays "gym"/"gym-b" — NOT recomputed to "platform" — because ownerGym
    // is immutable historical provenance, not a live reflection of the
    // current package. See lib/db.ts's documented open question on this.
    expect(h.saveSubscription.mock.calls[0][0].ownerGym).toEqual({ scope: "gym", gymId: "gym-b" });
  });

  it("preserves the EXISTING row's ownerGym across a tier change — app_subscription -> membership", async () => {
    h.findSubscriptionByUserId.mockReturnValue({
      userId: MEMBER_B.id, packageId: "pkg-app", status: "active", ownerGym: { scope: "platform" },
    });
    await grantMemberTier(MEMBER_B.id, "membership", { packageId: "pkg-b" });
    expect(h.saveSubscription.mock.calls[0][0].ownerGym).toEqual({ scope: "platform" });
  });

  it("preserves the EXISTING row's ownerGym on a downgrade to free", async () => {
    h.findSubscriptionByUserId.mockReturnValue({
      userId: MEMBER_B.id, packageId: "pkg-b", status: "active", ownerGym: { scope: "gym", gymId: "gym-b" },
    });
    await grantMemberTier(MEMBER_B.id, "free");
    expect(h.saveSubscription.mock.calls[0][0].ownerGym).toEqual({ scope: "gym", gymId: "gym-b" });
  });

  it("falls back to explicit unresolved (never silently recomputed) for a legacy row with no stored ownerGym", async () => {
    h.findSubscriptionByUserId.mockReturnValue({
      userId: MEMBER_B.id, packageId: "pkg-b", status: "active", ownerGym: undefined,
    });
    await grantMemberTier(MEMBER_B.id, "app_subscription");
    // NOT recomputed to "platform" from the new tier, and NOT left as a bare
    // undefined either — an existing row always gets an explicit scope.
    expect(h.saveSubscription.mock.calls[0][0].ownerGym).toEqual({ scope: "unresolved" });
  });

  it("never persists a subscription for a rejected cross-gym packageId", async () => {
    const result = await grantMemberTier(MEMBER_A.id, "membership", { packageId: "pkg-b" });
    expect(result.ok).toBe(false);
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });
});
