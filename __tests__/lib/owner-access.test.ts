// Owner decision 2026-10-30: admin managers and the platform operator hold every member feature without a plan, and their AI allowance is 150% of
// their group's setting (they demonstrate the AI features to members on their own accounts). Coaches and admins are ordinary accounts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findSubscriptionByUserId: vi.fn(() => undefined),
  findDigitalEntitlementsByUserId: vi.fn((): unknown[] => []),
  findMembershipPackageById: vi.fn(),
  findMembershipBillingOptionById: vi.fn(),
  findAiUsageLogsByUserId: vi.fn(() => []),
  findProfileByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

import { allowanceKindFor, memberBudgetUsd } from "@/lib/ai-allowance";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";

const users: Record<string, { id: string; role: string; archivedAt: string | null }> = {
  operator: { id: "operator", role: "platform_operator", archivedAt: null },
  manager: { id: "manager", role: "admin_manager", archivedAt: null },
  admin: { id: "admin", role: "admin", archivedAt: null },
  coach: { id: "coach", role: "coach", archivedAt: null },
  member: { id: "member", role: "member", archivedAt: null },
  former: { id: "former", role: "admin_manager", archivedAt: "2026-01-01T00:00:00.000Z" },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => users[id]);
  vi.stubEnv("AI_ALLOWANCE_COMPLIMENTARY_EUR", "2");
  vi.stubEnv("AI_ALLOWANCE_FREE_EUR", "0");
  vi.stubEnv("AI_USD_PER_EUR", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("owner access", () => {
  it("admin managers and the platform operator hold the App Subscription and the gym Membership without a plan", () => {
    expect(resolveMemberAccessForUser("operator")).toEqual({ gymMembership: true, digital: true });
    expect(resolveMemberAccessForUser("manager")).toEqual({ gymMembership: true, digital: true });
  });

  it("admins, coaches, members and archived managers get only what they hold", () => {
    for (const id of ["admin", "coach", "member", "former"]) expect(resolveMemberAccessForUser(id)).toEqual({ gymMembership: false, digital: false });
  });

  it("an owner's AI use is metered as complimentary, at 150% of the complimentary setting", () => {
    expect(allowanceKindFor("operator", Date.now())).toBe("complimentary");
    expect(memberBudgetUsd("operator", "complimentary")).toBeCloseTo(3);
    expect(memberBudgetUsd("manager", "complimentary")).toBeCloseTo(3);
  });

  it("everyone else keeps their group and its plain setting", () => {
    expect(allowanceKindFor("coach", Date.now())).toBe("free");
    expect(memberBudgetUsd("member", "complimentary")).toBeCloseTo(2);
    expect(memberBudgetUsd("admin", "complimentary")).toBeCloseTo(2);
  });
});
