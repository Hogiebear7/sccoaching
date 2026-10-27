// Staff-side data wall: the owned data of a member without a gym Membership (workouts, recovery, nutrition, messages,
// emergency contacts — everything), digital-only subscribers included, stays invisible to staff until the member holds a
// gym Membership. Re-derives access per call, never cached/stored, so access never lags a change in either direction. See
// the mirroring member-initiated-message gate in app/api/messages/send/route.ts, and lib/member-access.ts's
// hasGymMembership() this is built on.
//
// Deliberately separate from lib/permissions.ts's can()/Capability system —
// that answers "can this staff role do X," this answers "is this member's
// data even in scope for staff to see at all." Folding one into the other
// would conflate staff seniority with member tier, the same reasoning
// member-access.ts's own header comment gives for keeping tier and role rank
// apart.
import { hasGymMembership } from "./member-access";
import { resolveMemberAccessForUser } from "./membership-entitlement";

export function staffCanViewMemberData(userId: string): boolean {
  return hasGymMembership(resolveMemberAccessForUser(userId));
}
