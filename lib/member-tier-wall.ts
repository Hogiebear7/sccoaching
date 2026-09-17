// Staff-side data wall: Free and App Subscription tier members' owned data
// (workouts, recovery, nutrition, messages, emergency contacts — everything)
// stays invisible to staff until the member holds a Membership-tier
// subscription. Re-derives tier per call, never cached/stored, so access
// never lags a tier change in either direction. See the mirroring
// member-initiated-message gate in app/api/messages/send/route.ts, and
// lib/member-access.ts's isMembershipTier() this is built on.
//
// Deliberately separate from lib/permissions.ts's can()/Capability system —
// that answers "can this staff role do X," this answers "is this member's
// data even in scope for staff to see at all." Folding one into the other
// would conflate staff seniority with member tier, the same reasoning
// member-access.ts's own header comment gives for keeping tier and role rank
// apart.
import { findSubscriptionByUserId } from "./db";
import { isMembershipTier } from "./member-access";
import { resolveMemberTier } from "./membership-entitlement";

export function staffCanViewMemberData(userId: string): boolean {
  return isMembershipTier(resolveMemberTier(findSubscriptionByUserId(userId)));
}
