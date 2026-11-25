// The request-time side of the tenant lockout (the rule itself is lib/tenant-billing.ts).
//
// OFF BY DEFAULT. Nothing is ever locked unless TENANT_LOCKOUT_ENABLED is exactly "true" on the server, so merging and deploying this changes nothing for S&C
// or any gym until the owner switches it on. The primary gym (gymId null) and platform operators are never locked, whatever the data says.
//
// Enforced where a request is turned into a verified tenant context (lib/tenant-request.ts), so every route that uses it is covered with no per-route code.
// Routes not yet on the tenant context are not enforced yet; the list and the plan to convert them are in docs/tenant-lockout-2026-11.md.
import { NextResponse } from "next/server";

import { findGymById } from "./db";
import { tenantAccess, type TenantAccess } from "./tenant-billing";
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
