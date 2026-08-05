// Central RBAC model for the staff area. ONE source of truth for "who can do
// what" — routes, pages, and nav all ask this module rather than hardcoding
// role strings. Hierarchical + least-privilege: coach < admin < admin_manager.
//
// Legacy note: the app previously had a single elevated role "staff". It is
// kept here as an alias that ranks as admin_manager, so any legacy stored row
// (or older test) that still says "staff" behaves as a full admin. readDb
// migrates stored "staff" → "admin_manager" on read; new writes never use it.

import type { UserRole } from "./profile-schema";

export type StaffRole = "coach" | "admin" | "admin_manager";

// The roles an admin_manager can assign in the staff-users UI.
export const ASSIGNABLE_STAFF_ROLES: StaffRole[] = ["coach", "admin", "admin_manager"];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  coach: "Coach",
  admin: "Admin",
  admin_manager: "Admin manager",
};

// Higher number = more privilege. member is 0; the legacy "staff" alias sits
// at the top so it retains the full access it always had.
const ROLE_RANK: Record<string, number> = {
  member: 0,
  coach: 1,
  admin: 2,
  admin_manager: 3,
  staff: 3, // legacy alias — full access
};

function rank(role: string | null | undefined): number {
  return ROLE_RANK[role ?? "member"] ?? 0;
}

export function isStaffRole(role: string | null | undefined): boolean {
  return rank(role) >= ROLE_RANK.coach;
}

// Every gated action in the staff area. Keep this list the single enumeration
// of capabilities; add a new one here and map it below.
export type Capability =
  | "staff.access" // enter the staff area at all
  | "classes.manage" // classes CRUD, series, attendance, class workouts
  | "exercises.manage" // exercises CRUD + AI generation
  | "members.view" // see member list + detail
  | "members.edit" // edit member coaching profile fields + coach notes
  | "members.coaching" // AI coach summary / draft reply
  | "members.account" // account-security actions: archive, reset password, change login email
  | "members.hardDelete" // permanently delete an ARCHIVED member + their records
  | "members.billing" // membership activate, subscription set, extra sessions
  | "catalog.manage" // membership catalog CRUD
  | "operations.view" // operations dashboard, housekeeping, class categories
  | "staffUsers.manage" // create/manage elevated users
  | "finance.view" // revenue figures, breakdowns, tax estimate — top role only
  | "reports.view" // membership + class reporting (no monetary figures)
  | "bugReports.manage"; // TRIAL-ONLY — triage trial-period bug reports, see docs/bug-reports.md

// The MINIMUM role each capability requires. Because roles are hierarchical, a
// higher role automatically satisfies everything a lower one can do.
const CAPABILITY_MIN_ROLE: Record<Capability, StaffRole> = {
  "staff.access": "coach",
  "classes.manage": "coach",
  "exercises.manage": "coach",
  "members.view": "coach",
  "members.edit": "coach",
  "members.coaching": "coach",
  // Account-security actions (deactivate, reset password, change login email)
  // are admin+, not coach — a coach manages training data, not the account.
  "members.account": "admin",
  // Permanent deletion is irreversible, so it's the top role only.
  "members.hardDelete": "admin_manager",
  "members.billing": "admin",
  "catalog.manage": "admin",
  "operations.view": "admin",
  "staffUsers.manage": "admin_manager",
  // Revenue figures are the most sensitive data in the staff area — same
  // tier as permanent deletion and staff-user management.
  "finance.view": "admin_manager",
  // Membership/class counts, no money — same tier as Operations.
  "reports.view": "admin",
  // All-hands triage during the trial period — same tier as classes.manage.
  "bugReports.manage": "coach",
};

export function can(role: UserRole | string | null | undefined, capability: Capability): boolean {
  return rank(role) >= rank(CAPABILITY_MIN_ROLE[capability]);
}

// Nav item → capability that reveals it. Used by the staff layout so the menu
// only shows sections the user may actually enter (backed by page guards).
export const NAV_CAPABILITY: Record<string, Capability> = {
  "/staff/operations": "operations.view",
  "/staff/classes": "classes.manage",
  "/staff/members": "members.view",
  "/staff/messages": "members.view",
  "/staff/catalog": "catalog.manage",
  "/staff/exercises": "exercises.manage",
  "/staff/staff-users": "staffUsers.manage",
  "/staff/finances": "finance.view",
  "/staff/reports": "reports.view",
  "/staff/bug-reports": "bugReports.manage",
};
