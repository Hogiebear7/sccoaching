import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindSubscriptionByUserId, mockFindMembershipPackageById } = vi.hoisted(() => ({
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindMembershipPackageById: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findMembershipPackageById: mockFindMembershipPackageById,
}));

describe("staffCanViewMemberData", () => {
  beforeEach(() => {
    mockFindSubscriptionByUserId.mockReset();
    mockFindMembershipPackageById.mockReset();
  });

  it("is false with no subscription (free tier)", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    const { staffCanViewMemberData } = await import("@/lib/member-tier-wall");
    expect(staffCanViewMemberData("user-1")).toBe(false);
  });

  it("is false for an app_subscription (app_only) package", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({ packageId: "pkg-1", status: "active" });
    mockFindMembershipPackageById.mockReturnValue({ id: "pkg-1", deliveryChannel: "app_only" });
    const { staffCanViewMemberData } = await import("@/lib/member-tier-wall");
    expect(staffCanViewMemberData("user-1")).toBe(false);
  });

  it("is true for an active in_person/hybrid package (membership tier)", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({ packageId: "pkg-2", status: "active" });
    mockFindMembershipPackageById.mockReturnValue({ id: "pkg-2", deliveryChannel: "in_person" });
    const { staffCanViewMemberData } = await import("@/lib/member-tier-wall");
    expect(staffCanViewMemberData("user-1")).toBe(true);
  });

  it("is false once the membership subscription is canceled", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({ packageId: "pkg-2", status: "canceled" });
    mockFindMembershipPackageById.mockReturnValue({ id: "pkg-2", deliveryChannel: "in_person" });
    const { staffCanViewMemberData } = await import("@/lib/member-tier-wall");
    expect(staffCanViewMemberData("user-1")).toBe(false);
  });
});
