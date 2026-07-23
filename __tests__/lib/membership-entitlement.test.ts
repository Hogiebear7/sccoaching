import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindMembershipPackageById,
  mockFindMembershipBillingOptionById,
  mockFindMembershipPlanById,
} = vi.hoisted(() => ({
  mockFindMembershipPackageById: vi.fn(),
  mockFindMembershipBillingOptionById: vi.fn(),
  mockFindMembershipPlanById: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findMembershipPackageById: mockFindMembershipPackageById,
  findMembershipBillingOptionById: mockFindMembershipBillingOptionById,
  findMembershipPlanById: mockFindMembershipPlanById,
}));

import {
  billingIntervalFromOption,
  resolveSubscriptionEntitlement,
} from "@/lib/membership-entitlement";

const PACKAGE = {
  id: "pkg-1",
  categoryId: "c1",
  name: "Unlimited Sessions",
  slug: "unlimited",
  shortDescription: null,
  fullDescription: null,
  packageType: "membership" as const,
  sessionAllowanceType: "unlimited" as const,
  sessionAllowanceCount: null,
  eligibleClassTypes: ["semi_private_pt"],
  visible: true,
  sortOrder: 0,
  stripeProductId: null,
  createdAt: "x",
  updatedAt: "x",
};

const OPTION = {
  id: "opt-1",
  packageId: "pkg-1",
  name: "Quarterly",
  billingType: "recurring" as const,
  intervalUnit: "month" as const,
  intervalCount: 3,
  amountCents: 72000,
  currency: "eur",
  visible: true,
  sortOrder: 0,
  stripePriceId: null,
  createdAt: "x",
  updatedAt: "x",
};

function sub(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    planId: null,
    status: "active" as const,
    provider: "stripe" as const,
    providerCustomerId: null,
    providerSubscriptionId: null,
    providerSetupOrderId: null,
    currentPeriodEnd: null,
    lastWebhookEventAt: null,
    sessionsUsedThisPeriod: 0,
    extraSessionGrants: [],
    periodLapsedNotifiedAt: null,
    createdAt: "x",
    updatedAt: "x",
    ...overrides,
  };
}

describe("billingIntervalFromOption", () => {
  it("collapses cadence onto the app's BillingInterval", () => {
    expect(billingIntervalFromOption({ intervalUnit: "month", intervalCount: 1 })).toBe("monthly");
    expect(billingIntervalFromOption({ intervalUnit: "month", intervalCount: 3 })).toBe("quarterly");
    expect(billingIntervalFromOption({ intervalUnit: "year", intervalCount: 1 })).toBe("annual");
    expect(billingIntervalFromOption(undefined)).toBe("monthly");
  });
});

describe("resolveSubscriptionEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMembershipPackageById.mockReturnValue(PACKAGE);
    mockFindMembershipBillingOptionById.mockReturnValue(OPTION);
    mockFindMembershipPlanById.mockReturnValue(undefined);
  });

  it("derives a plan-shaped entitlement from a package (unlimited → null allowance)", () => {
    const plan = resolveSubscriptionEntitlement(sub({ packageId: "pkg-1", billingOptionId: "opt-1" }));
    expect(plan).toMatchObject({
      name: "Unlimited Sessions",
      monthlySessionAllowance: null,
      allowedCategories: ["semi_private_pt"],
      billingInterval: "quarterly",
      priceCents: 72000,
    });
  });

  it("uses the package's session count for fixed_count", () => {
    mockFindMembershipPackageById.mockReturnValue({
      ...PACKAGE, sessionAllowanceType: "fixed_count", sessionAllowanceCount: 12,
    });
    const plan = resolveSubscriptionEntitlement(sub({ packageId: "pkg-1", billingOptionId: "opt-1" }));
    expect(plan?.monthlySessionAllowance).toBe(12);
  });

  it("falls back to the legacy plan when there is no package link", () => {
    mockFindMembershipPlanById.mockReturnValue({ id: "legacy", name: "Legacy Plan", monthlySessionAllowance: 8 });
    const plan = resolveSubscriptionEntitlement(sub({ planId: "legacy" }));
    expect(plan?.name).toBe("Legacy Plan");
    expect(mockFindMembershipPackageById).not.toHaveBeenCalled();
  });

  it("falls back to the legacy plan when the package vanished", () => {
    mockFindMembershipPackageById.mockReturnValue(undefined);
    mockFindMembershipPlanById.mockReturnValue({ id: "legacy", name: "Legacy", monthlySessionAllowance: 4 });
    const plan = resolveSubscriptionEntitlement(sub({ packageId: "gone", planId: "legacy" }));
    expect(plan?.name).toBe("Legacy");
  });

  it("returns undefined for no subscription / no links", () => {
    expect(resolveSubscriptionEntitlement(undefined)).toBeUndefined();
    expect(resolveSubscriptionEntitlement(sub())).toBeUndefined();
  });
});
