// Tenant-boundary check for the gym marketplace (see lib/gyms-schema.ts) —
// deliberately separate from lib/permissions.ts's can()/Capability system
// and from lib/member-tier-wall.ts's tier wall, the same way member-access.ts's
// own header comment argues for keeping tier and role rank apart: role
// capability ("can this coach edit members"), member tier ("is this
// member's data visible yet"), and gym scope ("is this even the same
// business") are three orthogonal questions, and conflating any two of them
// would make all of them read wrong.
//
// UserRecord.gymId is optional/nullable, and null means "the primary gym"
// (S&C Performance Coaching) — every account created before this field
// existed reads as null, so it needs no backfill migration; only a
// self-serve gym signup ever sets a real id. Comparing null to null is
// still a match, which is exactly the "every existing account implicitly
// belongs to S&C" behavior this is meant to preserve.
import { findUserById, type MembershipPackageRecord, type MoneyRecordOwnerGym } from "./db";

export function sameGym(a: { gymId?: string | null }, b: { gymId?: string | null }): boolean {
  return (a.gymId ?? null) === (b.gymId ?? null);
}

// Convenience for the common staff-route shape: staff user already in hand,
// only the target's id known. Returns false (not throws) for a target that
// no longer exists — callers already 404 on that separately.
export function sameGymAsStaff(staffUser: { gymId?: string | null }, targetUserId: string): boolean {
  const target = findUserById(targetUserId);
  return !!target && sameGym(staffUser, target);
}

// The App Subscription is a single platform-wide product, sold through the
// shared app/store presence rather than per gym — see the approved catalog
// tenant-isolation decision record (2026-09). deliveryChannel === "app_only"
// is the ONLY marker for this exception. Deliberately never billingChannel
// (also covers "manual", used for ordinary non-Stripe gym arrangements),
// never the package slug (fragile string match on one hardcoded value), and
// never gymId === null (that's the unrelated "primary gym" convention, not
// a "this is global" signal — S&C's own gym isn't special-cased here).
export function isGlobalCatalogPackage(pkg: Pick<MembershipPackageRecord, "deliveryChannel">): boolean {
  return pkg.deliveryChannel === "app_only";
}

// Whether `staff` may read/manage `pkg`. `category` must already be
// resolved by the caller (this file does no catalog-table reads of its
// own) — pass undefined for a package whose category can't be resolved,
// which fails closed exactly like a genuinely missing package unless the
// global exception above applies.
export function staffAuthorizedForCatalogPackage(
  staff: { gymId?: string | null },
  pkg: Pick<MembershipPackageRecord, "deliveryChannel">,
  category: { gymId?: string | null } | undefined
): boolean {
  return isGlobalCatalogPackage(pkg) || (!!category && sameGym(staff, category));
}

// ── MoneyRecordOwnerGym builders ────────────────────────────────────────
// Every money record (Purchase, PaymentEvent, PassLedgerEntry,
// FinanceLedgerEntry — see lib/db.ts) is stamped with one of these at write
// time. Centralized here so every call site derives ownership the same way
// as the existing catalog-checkout authorization check above, rather than
// re-deriving the rule ad hoc per route.

// For a catalog purchase/subscription: mirrors the exact check already used
// to AUTHORIZE the purchase (isGlobalCatalogPackage / sameGym above) — this
// is not a new rule, it's the existing one's result, persisted. Caller must
// have already failed closed on an unresolved category before a purchase is
// created; `category: undefined` for a resolvable package is a caller bug,
// not a real state, so it maps to "unresolved" rather than throwing (a
// dead-money-movement record should never be silently mis-scoped as
// platform-wide or a wrong gym).
export function ownerGymForCatalogPackage(
  pkg: Pick<MembershipPackageRecord, "deliveryChannel">,
  category: { gymId?: string | null } | undefined
): MoneyRecordOwnerGym {
  if (isGlobalCatalogPackage(pkg)) return { scope: "platform" };
  if (!category) return { scope: "unresolved" };
  return { scope: "gym", gymId: category.gymId ?? null };
}

// For a booking-driven or user-linked money record: the acting/owning
// member's OWN current gym is authoritative — never a client-supplied value,
// never the acting staff member's gym (a staff action on a member's ledger
// belongs to the member's gym, not the staff's).
export function ownerGymForUser(user: { gymId?: string | null }): MoneyRecordOwnerGym {
  return { scope: "gym", gymId: user.gymId ?? null };
}

// Whether two resolved catalog scopes are the SAME ownership scope — used to
// keep an ordinary web/Stripe subscription switch inside the member's
// CURRENT scope (see app/api/membership/checkout/route.ts's switch branch).
// Gym-owned and the platform-global App Subscription are two structurally
// different products, not points on one price ladder, so a switch that
// crosses between them is a channel change this generic route must reject,
// not an ordinary plan change. "unresolved" never matches anything,
// including itself: a scope this code can't prove is never treated as
// equivalent to another scope it also can't prove — allowing that would
// silently let through a transition neither side actually vouches for.
export function catalogScopesMatch(a: MoneyRecordOwnerGym, b: MoneyRecordOwnerGym): boolean {
  if (a.scope === "unresolved" || b.scope === "unresolved") return false;
  if (a.scope !== b.scope) return false;
  if (a.scope === "gym" && b.scope === "gym") return (a.gymId ?? null) === (b.gymId ?? null);
  return true;
}
