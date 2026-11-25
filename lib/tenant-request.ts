// Request-boundary helpers that produce a verified TenantContext (lib/tenant-context.ts).
//
// Use these at the very top of a route, then pass the returned context down. Nothing below the
// route should look at a client-supplied gym id or user id except to compare it against the
// context, or to look up a target through loadTenantUser, which fails closed.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, type StoredUser } from "./db";
import { verifyRequestSession } from "./mobile-auth";
import type { Capability } from "./permissions";
import { authorizeStaffRequest } from "./staff-auth";
import { buildTenantContext, inTenant, type TenantContext } from "./tenant-context";
import { lockoutResponse } from "./tenant-lockout";

export type TenantRequestResult =
  | { ok: true; user: StoredUser; ctx: TenantContext }
  | { ok: false; response: NextResponse };

// Member or staff session, web cookie or mobile Bearer. An archived or deleted account reads
// exactly like no session (see verifyRequestSession), so the response never says which.
// A locked tenant (platform subscription unpaid past its grace, and only when TENANT_LOCKOUT_ENABLED is on) is refused here with a 423. `allowWhenLocked` is for
// the few routes that tenant's own staff still need, such as the page where they pay.
export function resolveTenantRequest(request: NextRequest, options: { unauthenticatedMessage?: string; allowWhenLocked?: boolean } = {}): TenantRequestResult {
  const session = verifyRequestSession(request);
  const user = session ? findUserById(session.userId) : undefined;
  if (!user || user.archivedAt) {
    // A route may keep its own 401 wording so adopting the helper never changes what a client sees.
    return { ok: false, response: NextResponse.json({ success: false, message: options.unauthenticatedMessage ?? "You must be signed in." }, { status: 401 }) };
  }
  const ctx = buildTenantContext(user);
  const locked = lockoutResponse(ctx, { allowWhenLocked: options.allowWhenLocked });
  if (locked) return { ok: false, response: locked };
  return { ok: true, user, ctx };
}

// Staff session that holds the capability. Delegates to authorizeStaffRequest so the 401 and
// 403 bodies stay identical to every existing staff route.
export function resolveStaffTenantRequest(
  request: NextRequest,
  capability: Capability,
  options: { allowWhenLocked?: boolean; allowAppToken?: boolean } = {}
): TenantRequestResult {
  const auth = authorizeStaffRequest(request, capability, { allowAppToken: options.allowAppToken });
  if (!auth.ok) return auth;
  const ctx = buildTenantContext(auth.user);
  const locked = lockoutResponse(ctx, { allowWhenLocked: options.allowWhenLocked });
  if (locked) return { ok: false, response: locked };
  return { ok: true, user: auth.user, ctx };
}

// For a route that has already authenticated its own user (the older routes read the session themselves): builds the verified tenant context from that account and
// applies the tenant lockout. Returns the refusal to send back (a 423) or null to go ahead. Call it straight after the route's own sign-in and permission check:
//
//   const tenantLock = requireTenantAccess(user);
//   if (tenantLock) return tenantLock;
//
// A no-op unless TENANT_LOCKOUT_ENABLED is on (lib/tenant-lockout.ts), and the primary gym and platform operators are never locked.
export function requireTenantAccess(user: StoredUser, options: { allowWhenLocked?: boolean } = {}): NextResponse | null {
  return lockoutResponse(buildTenantContext(user), options);
}

// The same, for a route that only has the signed-in user's id (it never loads the account itself).
export function requireTenantAccessForUserId(userId: string, options: { allowWhenLocked?: boolean } = {}): NextResponse | null {
  const user = findUserById(userId);
  return user ? requireTenantAccess(user, options) : null;
}

// Loads a target account by a client-supplied id, but only if it is in the context's tenant.
// A missing account and an account in another tenant both return undefined, so the caller can
// answer both with one identical 404 and never confirm that a guessed id exists elsewhere.
export function loadTenantUser(ctx: TenantContext, targetUserId: string | null | undefined): StoredUser | undefined {
  if (typeof targetUserId !== "string" || targetUserId.trim() === "") return undefined;
  const target = findUserById(targetUserId);
  if (!target || !inTenant(ctx, target)) return undefined;
  return target;
}

// The one non-disclosing answer for "no such target in your tenant".
export function tenantNotFoundResponse(message = "Not found."): NextResponse {
  return NextResponse.json({ success: false, message }, { status: 404 });
}
