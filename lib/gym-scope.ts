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
import { findUserById } from "./db";

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
