// lib/tier-grant.ts's grantMemberTier — an optional end date on a staff-granted gym Membership (owner request 2026-10-29), and a fresh
// grant never inheriting the end of an earlier, lapsed period. What happens once the date passes (booking blocked, the member warned, the
// Membership ended 3 days later) is the existing lapse handling, tested with lib/membership-status and the lapse jobs.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMembershipCategories: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findMembershipPackages: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  saveSubscription: vi.fn(),
  findDigitalEntitlement: vi.fn(),
  grantStaffDigitalEntitlement: vi.fn(),
  cancelProviderSubscription: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/billing", () => ({ cancelProviderSubscription: h.cancelProviderSubscription }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveMemberAccessForUser: () => ({ digital: false, gymMembership: true }) }));
vi.mock("@/lib/digital-entitlement", () => ({ grantStaffDigitalEntitlement: h.grantStaffDigitalEntitlement, revokeStaffDigitalEntitlement: vi.fn() }));

import { isPeriodLapsed } from "@/lib/membership-status";
import { grantMemberTier } from "@/lib/tier-grant";

const MEMBER = { id: "member-a", email: "a@x.test", role: "member", gymId: null };
const PKG = { id: "pkg-a", categoryId: "cat-a", deliveryChannel: "in_person", sortOrder: 0, slug: "pkg-a" };
const ENDS_AT = "2099-11-14T23:59:59.999Z";
const saved = () => h.saveSubscription.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  h.findMembershipCategories.mockReturnValue([{ id: "cat-a", gymId: null }]);
  h.findMembershipPackages.mockReturnValue([PKG]);
  h.findMembershipPackageById.mockImplementation((id: string) => (id === PKG.id ? PKG : undefined));
  h.findUserById.mockReturnValue(MEMBER);
  h.findSubscriptionByUserId.mockReturnValue(undefined);
  h.cancelProviderSubscription.mockResolvedValue({ ok: true });
});

describe("grantMemberTier — gym Membership end date", () => {
  it("a grant with an end date stores it as the period end", async () => {
    await grantMemberTier(MEMBER.id, "membership", { endsAt: ENDS_AT });
    expect(saved()).toMatchObject({ status: "active", provider: "none", currentPeriodEnd: ENDS_AT });
  });

  it("a grant without one is open-ended", async () => {
    await grantMemberTier(MEMBER.id, "membership");
    expect(saved().currentPeriodEnd).toBeNull();
  });

  it("a fresh grant after an earlier lapsed Membership does not inherit the old end, so it is not lapsed the moment it is given", async () => {
    h.findSubscriptionByUserId.mockReturnValue({
      userId: MEMBER.id, packageId: PKG.id, status: "canceled", provider: "none", currentPeriodEnd: "2020-01-31T23:59:59.999Z", ownerGym: { scope: "gym", gymId: null },
    });
    await grantMemberTier(MEMBER.id, "membership");
    expect(saved().currentPeriodEnd).toBeNull();
    expect(isPeriodLapsed(saved())).toBe(false);
  });

  it("re-granting an active Membership with a new end date replaces the end; without one it keeps the current end", async () => {
    const active = { userId: MEMBER.id, packageId: PKG.id, status: "active", provider: "none", currentPeriodEnd: "2099-01-31T23:59:59.999Z", ownerGym: { scope: "gym", gymId: null } };
    h.findSubscriptionByUserId.mockReturnValue(active);
    await grantMemberTier(MEMBER.id, "membership", { endsAt: ENDS_AT });
    expect(saved().currentPeriodEnd).toBe(ENDS_AT);
    h.saveSubscription.mockClear();
    await grantMemberTier(MEMBER.id, "membership");
    expect(saved().currentPeriodEnd).toBe(active.currentPeriodEnd);
  });

  it("once the end date has passed the Membership counts as lapsed (the existing lapse handling takes over from there)", async () => {
    await grantMemberTier(MEMBER.id, "membership", { endsAt: "2099-11-14T23:59:59.999Z" });
    expect(isPeriodLapsed(saved())).toBe(false);
    expect(isPeriodLapsed({ ...saved(), currentPeriodEnd: "2000-01-01T23:59:59.999Z" })).toBe(true);
  });

  it("ending a gym Membership keeps its recorded end", async () => {
    h.findSubscriptionByUserId.mockReturnValue({ userId: MEMBER.id, packageId: PKG.id, status: "active", provider: "none", currentPeriodEnd: ENDS_AT, ownerGym: { scope: "gym", gymId: null } });
    await grantMemberTier(MEMBER.id, "free");
    expect(saved()).toMatchObject({ status: "canceled", currentPeriodEnd: ENDS_AT });
  });
});
