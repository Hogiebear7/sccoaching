// The platform_operator role and the platform-only capabilities (lib/permissions.ts).
//   * gyms.moderate, finance.view and platform.jobs are satisfied by the
//     platform_operator role ALONE — checked by exact role, never by rank. No
//     tenant role (admin_manager and the legacy "staff" alias included), no
//     member, and no null/undefined/unknown role satisfies them.
//   * The role is not assignable from the staff-users UI, and is a staff role
//     (it can sign in to the staff area) that ranks above admin_manager, so an
//     operator can still use every ordinary TENANT capability (which the routes
//     keep gym-scoped with sameGym()).
//   * Tenant capabilities are unchanged for tenant roles.
import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_STAFF_ROLES,
  STAFF_ROLE_LABEL,
  can,
  isPlatformOperator,
  isStaffRole,
  type Capability,
} from "@/lib/permissions";

const PLATFORM_ONLY: Capability[] = ["gyms.moderate", "finance.view", "platform.jobs"];
const TENANT_ROLES = ["coach", "admin", "admin_manager", "staff"] as const; // "staff" = legacy alias ranked as admin_manager
const NON_OPERATORS: (string | null | undefined)[] = ["member", ...TENANT_ROLES, "", "PLATFORM_OPERATOR", "platform-operator", "operator", "superadmin", null, undefined];

describe("platform-only capabilities", () => {
  it.each(PLATFORM_ONLY)("%s is satisfied by platform_operator", (capability) => {
    expect(can("platform_operator", capability)).toBe(true);
  });

  it.each(PLATFORM_ONLY)("%s is NOT satisfied by any tenant role, member, or missing/unknown role", (capability) => {
    for (const role of NON_OPERATORS) expect(can(role, capability)).toBe(false);
  });

  it("isPlatformOperator matches the exact role only", () => {
    expect(isPlatformOperator("platform_operator")).toBe(true);
    for (const role of NON_OPERATORS) expect(isPlatformOperator(role)).toBe(false);
  });
});

describe("the role model", () => {
  it("platform_operator is a staff role that cannot be assigned from the staff-users UI", () => {
    expect(isStaffRole("platform_operator")).toBe(true);
    expect(ASSIGNABLE_STAFF_ROLES).not.toContain("platform_operator");
    expect(ASSIGNABLE_STAFF_ROLES).toEqual(["coach", "admin", "admin_manager"]);
    expect(STAFF_ROLE_LABEL.platform_operator).toBe("Platform operator");
  });

  it("an operator satisfies the ordinary tenant capabilities by rank (the routes still apply sameGym)", () => {
    const tenantCaps: Capability[] = ["staff.access", "classes.manage", "members.view", "members.account", "members.hardDelete", "staffUsers.manage", "catalog.manage", "reports.view", "operations.view"];
    for (const capability of tenantCaps) expect(can("platform_operator", capability)).toBe(true);
  });

  it("tenant capabilities are unchanged for tenant roles", () => {
    expect(can("coach", "classes.manage")).toBe(true);
    expect(can("coach", "members.account")).toBe(false);
    expect(can("admin", "members.account")).toBe(true);
    expect(can("admin", "staffUsers.manage")).toBe(false);
    expect(can("admin_manager", "staffUsers.manage")).toBe(true);
    expect(can("admin_manager", "members.hardDelete")).toBe(true);
    expect(can("admin_manager", "reports.view")).toBe(true);
    expect(can("admin", "operations.view")).toBe(true);
    expect(can("member", "staff.access")).toBe(false);
  });

  it("gym.manageAvailability stays a tenant (admin) capability for the gym's own availability", () => {
    expect(can("admin", "gym.manageAvailability")).toBe(true);
    expect(can("coach", "gym.manageAvailability")).toBe(false);
  });
});
