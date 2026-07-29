import { describe, expect, it } from "vitest";

import { can, isStaffRole, type Capability } from "@/lib/permissions";

const COACH_CAPS: Capability[] = [
  "staff.access",
  "classes.manage",
  "exercises.manage",
  "members.view",
  "members.edit",
  "members.coaching",
];
const ADMIN_ONLY: Capability[] = [
  "members.account",
  "members.billing",
  "catalog.manage",
  "operations.view",
];
const MANAGER_ONLY: Capability[] = ["staffUsers.manage", "members.hardDelete"];

describe("isStaffRole", () => {
  it("recognises every elevated role and the legacy alias", () => {
    expect(isStaffRole("coach")).toBe(true);
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("admin_manager")).toBe(true);
    expect(isStaffRole("staff")).toBe(true); // legacy alias
  });
  it("rejects members and unknown/empty", () => {
    expect(isStaffRole("member")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
    expect(isStaffRole("banana")).toBe(false);
  });
});

describe("can — coach (least privilege)", () => {
  it("grants coach the coach-level capabilities", () => {
    for (const cap of COACH_CAPS) expect(can("coach", cap)).toBe(true);
  });
  it("denies coach all admin-only and manager-only capabilities", () => {
    for (const cap of [...ADMIN_ONLY, ...MANAGER_ONLY]) expect(can("coach", cap)).toBe(false);
  });
});

describe("can — admin", () => {
  it("grants admin the coach + admin capabilities", () => {
    for (const cap of [...COACH_CAPS, ...ADMIN_ONLY]) expect(can("admin", cap)).toBe(true);
  });
  it("denies admin the manager-only capability", () => {
    for (const cap of MANAGER_ONLY) expect(can("admin", cap)).toBe(false);
  });
});

describe("can — admin_manager (and legacy staff)", () => {
  it("grants admin_manager everything", () => {
    for (const cap of [...COACH_CAPS, ...ADMIN_ONLY, ...MANAGER_ONLY]) {
      expect(can("admin_manager", cap)).toBe(true);
    }
  });
  it("treats the legacy 'staff' alias as full access", () => {
    for (const cap of [...COACH_CAPS, ...ADMIN_ONLY, ...MANAGER_ONLY]) {
      expect(can("staff", cap)).toBe(true);
    }
  });
});

describe("can — member / unknown", () => {
  it("denies members everything", () => {
    for (const cap of [...COACH_CAPS, ...ADMIN_ONLY, ...MANAGER_ONLY]) {
      expect(can("member", cap)).toBe(false);
      expect(can(null, cap)).toBe(false);
    }
  });
});
