// The request-time side of the tenant lockout (the rule itself is lib/tenant-billing.ts).
//
// OFF BY DEFAULT. Nothing is ever locked unless TENANT_LOCKOUT_ENABLED is exactly "true" on the server, so merging and deploying this changes nothing for S&C
// or any gym until the owner switches it on. The primary gym (gymId null) and platform operators are never locked, whatever the data says.
//
// Enforced where a request is turned into a verified tenant context (lib/tenant-request.ts), so every route that uses it is covered with no per-route code.
// Routes not yet on the tenant context are not enforced yet; the list and the plan to convert them are in docs/tenant-lockout-2026-11.md.
import { NextResponse } from "next/server";

import { findGymById, type StoredUser } from "./db";
import { DEFAULT_TENANT_GRACE_DAYS, MAX_TENANT_GRACE_DAYS, tenantAccess, type TenantAccess } from "./tenant-billing";
import type { TenantContext } from "./tenant-context";

export function tenantLockoutEnabled(): boolean {
  return process.env.TENANT_LOCKOUT_ENABLED === "true";
}

/** The access state of the tenant a context belongs to. The primary gym and an unknown gym are always active. */
export function accessForTenant(ctx: Pick<TenantContext, "gymId" | "isPlatformOperator">, now: Date = new Date()): TenantAccess {
  if (ctx.isPlatformOperator || !ctx.gymId) return tenantAccess(undefined, now);
  return tenantAccess(findGymById(ctx.gymId), now);
}

export const TENANT_LOCKED_CODE = "tenant_locked";

/** The gym's own staff roles (a platform operator is never locked, so it is not listed). */
function isGymStaffRole(role: string): boolean {
  return role === "coach" || role === "admin" || role === "admin_manager";
}

/**
 * The refusal for a locked tenant, or null when the request may go ahead (lockout off, tenant active or in grace). `allowWhenLocked` is for the few routes a
 * locked gym's own staff still need, such as the page where they pay: staff of that gym pass, members never do.
 */
export function lockoutResponse(ctx: TenantContext, options: { allowWhenLocked?: boolean } = {}, now: Date = new Date()): NextResponse | null {
  if (!tenantLockoutEnabled()) return null;
  const access = accessForTenant(ctx, now);
  if (access.state !== "locked") return null;
  const isStaff = isGymStaffRole(ctx.role);
  if (options.allowWhenLocked && isStaff) return null;
  const message = isStaff
    ? "Your gym's platform subscription is overdue, so access is paused. Nothing has been deleted: it all comes back once the payment is made."
    : "This gym is temporarily unavailable. Nothing has been lost.";
  return NextResponse.json({ success: false, code: TENANT_LOCKED_CODE, message }, { status: 423 });
}

/** True when this account belongs to a gym that is locked right now (and the lockout switch is on). The primary gym and platform operators never are. */
export function userInLockedGym(user: Pick<StoredUser, "role" | "gymId"> | undefined | null, now: Date = new Date()): boolean {
  if (!user || !tenantLockoutEnabled()) return false;
  return accessForTenant({ gymId: user.gymId ?? null, isPlatformOperator: user.role === "platform_operator" }, now).state === "locked";
}

export interface TenantStatusForClient {
  state: "active" | "grace" | "locked";
  /** Last day before the lockout, while in grace. */
  graceEndsOn: string | null;
  graceDaysLeft: number | null;
  /** The gym's payment link, only for that gym's own staff and only while it is in grace or locked. */
  payUrl: string | null;
}

/**
 * Who is warned while a gym is in its grace period (owner decision 2026-11-25). The grace is split in two halves: in the first half only the gym's admins get the
 * warning; in the second half its coaches get it too. Members are never warned (a locked gym still shows them its plain unavailable screen). The warning is shown
 * every time the app or staff area opens, for as long as it applies.
 */
export function graceWarningApplies(role: string, graceDaysLeft: number | null, graceDaysTotal: number): boolean {
  if (role === "admin" || role === "admin_manager" || role === "staff") return true;
  if (role !== "coach" || graceDaysLeft === null) return false;
  const dayOfGrace = graceDaysTotal - graceDaysLeft + 1;
  return dayOfGrace > Math.ceil(graceDaysTotal / 2);
}

/** What the apps and pages show about the gym's platform subscription: always "active" while the lockout switch is off. */
export function tenantStatusFor(user: Pick<StoredUser, "role" | "gymId">, now: Date = new Date()): TenantStatusForClient {
  const none: TenantStatusForClient = { state: "active", graceEndsOn: null, graceDaysLeft: null, payUrl: null };
  if (!tenantLockoutEnabled() || !user.gymId || user.role === "platform_operator") return none;
  const gym = findGymById(user.gymId);
  const access = tenantAccess(gym, now);
  if (access.state === "active") return none;
  if (access.state === "grace") {
    const total = Math.max(0, Math.min(MAX_TENANT_GRACE_DAYS, Math.floor(gym?.platformBilling?.graceDays ?? DEFAULT_TENANT_GRACE_DAYS)));
    if (!graceWarningApplies(user.role, access.graceDaysLeft, total)) return none;
  }
  const staff = user.role === "coach" || user.role === "admin" || user.role === "admin_manager";
  return { state: access.state, graceEndsOn: access.graceEndsOn, graceDaysLeft: access.graceDaysLeft, payUrl: staff ? gym?.platformBilling?.payUrl ?? null : null };
}
