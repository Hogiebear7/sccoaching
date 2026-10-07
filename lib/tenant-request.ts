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

export type TenantRequestResult =
  | { ok: true; user: StoredUser; ctx: TenantContext }
  | { ok: false; response: NextResponse };

// Member or staff session, web cookie or mobile Bearer. An archived or deleted account reads
// exactly like no session (see verifyRequestSession), so the response never says which.
export function resolveTenantRequest(request: NextRequest, options: { unauthenticatedMessage?: string } = {}): TenantRequestResult {
  const session = verifyRequestSession(request);
  const user = session ? findUserById(session.userId) : undefined;
  if (!user || user.archivedAt) {
    // A route may keep its own 401 wording so adopting the helper never changes what a client sees.
    return { ok: false, response: NextResponse.json({ success: false, message: options.unauthenticatedMessage ?? "You must be signed in." }, { status: 401 }) };
  }
  return { ok: true, user, ctx: buildTenantContext(user) };
}

// Staff session that holds the capability. Delegates to authorizeStaffRequest so the 401 and
// 403 bodies stay identical to every existing staff route.
export function resolveStaffTenantRequest(request: NextRequest, capability: Capability): TenantRequestResult {
  const auth = authorizeStaffRequest(request, capability);
  if (!auth.ok) return auth;
  return { ok: true, user: auth.user, ctx: buildTenantContext(auth.user) };
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
