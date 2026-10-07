// The verified tenant context for one request.
//
// A tenant is a gym. A user belongs to exactly one gym (UserRecord.gymId, null = the primary
// gym), so the tenant of a request is a property of the AUTHENTICATED ACCOUNT, never of
// anything the client sends. This module is the single place that turns an authenticated
// account into a context, and the context is frozen so no downstream helper can swap it.
//
// Rules, each enforced by __tests__/lib/tenant-context.test.ts:
//  - A client-supplied gym id, header, query parameter or body field is only ever a SELECTOR
//    to be compared against this context. It is never the context.
//  - Comparison uses the same null-equals-null convention as lib/gym-scope.ts, so the primary
//    gym is a tenant like any other.
//  - A platform operator gets NO cross-gym reach through this module. Platform-only actions
//    are authorised by exact role (lib/permissions.ts), never by widening the tenant check.
//  - A lookup for a target that is missing and one that belongs to another tenant return the
//    same value, so an error can never confirm that a guessed id exists elsewhere.
//
// Dependency note: this file imports only types and pure helpers, so it is safe to use from
// any layer. Datastore-backed helpers live in lib/tenant-request.ts.

import { isPlatformOperator } from "./permissions";
import { sameGym } from "./gym-scope";

export interface TenantSubject {
  id: string;
  role?: string | null;
  gymId?: string | null;
}

export interface TenantContext {
  readonly userId: string;
  readonly role: string;
  /** The account's own gym. null is the primary gym, a real tenant. */
  readonly gymId: string | null;
  /** True only for the exact platform_operator role. Never implied by rank or by gymId null. */
  readonly isPlatformOperator: boolean;
}

export function buildTenantContext(user: TenantSubject): TenantContext {
  return Object.freeze({
    userId: user.id,
    role: user.role ?? "member",
    gymId: user.gymId ?? null,
    isPlatformOperator: isPlatformOperator(user.role),
  });
}

// True when the target resource is owned by the context's own tenant. A platform operator is
// deliberately not special-cased: operators work as ordinary tenant staff in their own gym.
export function inTenant(ctx: TenantContext, target: { gymId?: string | null }): boolean {
  return sameGym({ gymId: ctx.gymId }, target);
}

// Compares a client-supplied gym id selector with the verified tenant. An absent selector
// (undefined, null or "") means "use my tenant" and is accepted. A present selector must equal
// the verified tenant's own gym id, so a selector can confirm but never switch the context.
// The primary gym has no id (gymId null), so no non-empty selector can name it.
export function selectorMatchesTenant(ctx: TenantContext, selector: string | null | undefined): boolean {
  if (selector === undefined || selector === null || selector === "") return true;
  return ctx.gymId !== null && ctx.gymId === selector;
}

// Stable string for the tenant, for cache keys, rate-limit keys, log fields and storage path
// prefixes. "primary" cannot collide with a generated gym id (those are prefixed ids).
export function tenantKey(ctx: Pick<TenantContext, "gymId">): string {
  return `gym:${ctx.gymId ?? "primary"}`;
}

// Cache and rate-limit keys must carry the tenant and, for user-scoped data, the user. Every
// part is validated so an empty or separator-bearing value cannot collapse two keys together.
export type CacheClass = "global" | "tenant" | "user";

export function cacheKey(ctx: TenantContext, cacheClass: CacheClass, ...parts: string[]): string {
  for (const part of parts) {
    if (part === "" || part.includes("|")) {
      throw new Error("cacheKey parts must be non-empty and must not contain '|'.");
    }
  }
  const base = cacheClass === "global" ? "global" : cacheClass === "tenant" ? tenantKey(ctx) : `${tenantKey(ctx)}|user:${ctx.userId}`;
  return [base, ...parts].join("|");
}

// Whether a platform-only action may proceed. Exact-role, matching lib/permissions.ts, and
// intentionally not derived from the gym.
export function platformScopeAllowed(ctx: TenantContext): boolean {
  return ctx.isPlatformOperator;
}
