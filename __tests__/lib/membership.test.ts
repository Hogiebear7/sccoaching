import { beforeEach, describe, expect, it, vi } from "vitest";

import { isPeriodLapsed } from "@/lib/membership-status";

const { mockFindSubscriptionByUserId, mockFindMembershipPlans } = vi.hoisted(() => ({
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindMembershipPlans: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findMembershipPlans: mockFindMembershipPlans,
}));

describe("isPeriodLapsed", () => {
  it("is false for a non-active status regardless of period end", () => {
    expect(isPeriodLapsed({ status: "past_due", currentPeriodEnd: "2020-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("is false for active with no period end set", () => {
    expect(isPeriodLapsed({ status: "active", currentPeriodEnd: null })).toBe(false);
  });

  it("is false for active with a future period end", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(isPeriodLapsed({ status: "active", currentPeriodEnd: future })).toBe(false);
  });

  it("is true for active with a past period end", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isPeriodLapsed({ status: "active", currentPeriodEnd: past })).toBe(true);
  });
});

describe("hasActiveMembership", () => {
  beforeEach(() => {
    mockFindSubscriptionByUserId.mockReset();
  });

  it("returns false when there's no subscription", async () => {
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    const { hasActiveMembership } = await import("@/lib/membership");
    expect(hasActiveMembership("user-1")).toBe(false);
  });

  it("returns false when status is active but the period has lapsed", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({
      status: "active",
      currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    const { hasActiveMembership } = await import("@/lib/membership");
    expect(hasActiveMembership("user-1")).toBe(false);
  });

  it("returns true when status is active and the period hasn't lapsed", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    const { hasActiveMembership } = await import("@/lib/membership");
    expect(hasActiveMembership("user-1")).toBe(true);
  });

  it("returns true when status is active and there's no period end tracked", async () => {
    mockFindSubscriptionByUserId.mockReturnValue({ status: "active", currentPeriodEnd: null });
    const { hasActiveMembership } = await import("@/lib/membership");
    expect(hasActiveMembership("user-1")).toBe(true);
  });
});
