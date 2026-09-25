// Central RBAC model for the staff area. ONE source of truth for "who can do
// what" — routes, pages, and nav all ask this module rather than hardcoding
// role strings. Hierarchical + least-privilege: coach < admin < admin_manager.
//
// Legacy note: the app previously had a single elevated role "staff". It is
// kept here as an alias that ranks as admin_manager, so any legacy stored row
// (or older test) that still says "staff" behaves as a full admin. readDb
// migrates stored "staff" → "admin_manager" on read; new writes never use it.

import type { UserRole } from "./profile-schema";

export type StaffRole = "coach" | "admin" | "admin_manager" | "platform_operator";

// The one role that may use the platform-only capabilities below (gym
// moderation, platform Finance, session-triggered platform jobs). It is NEVER
// assignable from the staff-users UI or created by any route: it is granted
// only by the offline scripts/promote-platform-operator.mjs, to an existing
// staff account. It is deliberately not implied by any tenant role or by
// gymId: null — see can().
export const PLATFORM_OPERATOR_ROLE = "platform_operator" as const;

// The roles an admin_manager can assign in the staff-users UI. platform_operator
// is intentionally absent.
export const ASSIGNABLE_STAFF_ROLES: StaffRole[] = ["coach", "admin", "admin_manager"];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  coach: "Coach",
  admin: "Admin",
  admin_manager: "Admin manager",
  platform_operator: "Platform operator",
};

// Higher number = more privilege. member is 0; the legacy "staff" alias sits
// at the top so it retains the full access it always had.
const ROLE_RANK: Record<string, number> = {
  member: 0,
  coach: 1,
  admin: 2,
  admin_manager: 3,
  staff: 3, // legacy alias — full access
  // Ranks above admin_manager so an operator can still work as ordinary staff
  // (every TENANT capability below is still gym-scoped by sameGym() in the
  // routes — an operator gets no cross-gym reach there). The platform-only
  // capabilities do not use rank at all; see PLATFORM_ONLY_CAPABILITIES.
  platform_operator: 4,
};

function rank(role: string | null | undefined): number {
  return ROLE_RANK[role ?? "member"] ?? 0;
}

// The canonical rank, for callers that compare two accounts' roles (see
// lib/platform-operator-guard.ts). null/undefined/unknown roles rank as member.
export function roleRank(role: string | null | undefined): number {
  return rank(role);
}

export function isStaffRole(role: string | null | undefined): boolean {
  return rank(role) >= ROLE_RANK.coach;
}

export function isPlatformOperator(role: string | null | undefined): boolean {
  return role === PLATFORM_OPERATOR_ROLE;
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
  | "members.grantTier" // manually grant/change a member's access tier (single or bulk)
  | "catalog.manage" // membership catalog CRUD
  | "operations.view" // operations dashboard, housekeeping, class categories
  | "staffUsers.manage" // create/manage elevated users
  | "finance.view" // PLATFORM-ONLY (interim): the platform-wide Finance ledger, revenue, settings
  | "reports.view" // membership + class reporting (no monetary figures)
  | "programs.manage" // assign/edit member training programs (Workout A/B/C/D blocks)
  | "nutrition.manage" // assign/edit member nutrition targets (calories/macros)
  | "foodCatalog.manage" // moderate the shared common/branded food catalog
  | "bugReports.manage" // TRIAL-ONLY — triage trial-period bug reports, see docs/bug-reports.md
  | "comments.moderate" // review/remove reported Community comments
  | "gyms.moderate" // PLATFORM-ONLY: approve/suspend any OTHER gym in the directory
  | "platform.jobs" // PLATFORM-ONLY: trigger the platform-wide job set from a session
  | "gym.manageAvailability"; // toggle a gym's own acceptingNewEnquiries flag

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
  // Same tier as members.billing — a separate capability so it can diverge
  // later (e.g. a coach-level "grant" without full billing access) without
  // touching this map again.
  "members.grantTier": "admin",
  "catalog.manage": "admin",
  "operations.view": "admin",
  "staffUsers.manage": "admin_manager",
  // Revenue figures are the most sensitive data in the staff area. The Finance
  // ledger, revenue lines, purchases and settings are PLATFORM-WIDE (no gym
  // owns a ledger entry yet), so until per-gym Finance ownership is designed
  // only a platform operator may reach them — a tenant admin_manager may not.
  "finance.view": "platform_operator",
  // Membership/class counts, no money — same tier as Operations.
  "reports.view": "admin",
  // Coaches build and assign the training programs they coach — same tier
  // as classes.manage/exercises.manage.
  "programs.manage": "coach",
  // Coaches set/adjust the macro targets they coach a member toward — same
  // tier as programs.manage.
  "nutrition.manage": "coach",
  // The common/branded food catalog is shared across every member, not one
  // coach's own clients — same tier as catalog.manage (membership catalog).
  "foodCatalog.manage": "admin",
  // All-hands triage during the trial period — same tier as classes.manage.
  "bugReports.manage": "coach",
  // Any coach can act on a reported comment — same tier as bugReports.manage.
  "comments.moderate": "coach",
  // Approving or suspending a business is a PLATFORM decision, never a
  // tenant's: platform operator only, and never for the operator's own gym
  // (enforced in the route).
  "gyms.moderate": "platform_operator",
  // Running the platform-wide housekeeping job set from a session (the
  // CRON_SECRET path is separate and unchanged).
  "platform.jobs": "platform_operator",
  // Pulling a whole business off the discovery directory is a business-level
  // decision, not a per-coach one — admin, same tier as catalog.manage.
  "gym.manageAvailability": "admin",
};

// Capabilities that ONLY the platform_operator role satisfies. They are checked
// by exact role, never by rank, so no tenant role — however senior — and no
// gymId (including null, the primary-gym convention) can satisfy them, and a
// future change to the role ordering cannot silently widen them.
const PLATFORM_ONLY_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "gyms.moderate",
  "finance.view",
  "platform.jobs",
]);

export function can(role: UserRole | string | null | undefined, capability: Capability): boolean {
  if (PLATFORM_ONLY_CAPABILITIES.has(capability)) return isPlatformOperator(role);
  return rank(role) >= rank(CAPABILITY_MIN_ROLE[capability]);
}

// Nav item → capability that reveals it. Used by the staff layout so the menu
// only shows sections the user may actually enter (backed by page guards).
export const NAV_CAPABILITY: Record<string, Capability> = {
  "/staff/operations": "operations.view",
  "/staff/classes": "classes.manage",
  "/staff/workouts": "classes.manage",
  "/staff/members": "members.view",
  "/staff/attendance": "members.view",
  "/staff/messages": "members.view",
  "/staff/catalog": "catalog.manage",
  "/staff/exercises": "exercises.manage",
  "/staff/exercise-library": "exercises.manage",
  "/staff/staff-users": "staffUsers.manage",
  "/staff/finances": "finance.view",
  "/staff/reports": "reports.view",
  "/staff/nutrition-submissions": "foodCatalog.manage",
  "/staff/bug-reports": "bugReports.manage",
  "/staff/community-reports": "comments.moderate",
};
