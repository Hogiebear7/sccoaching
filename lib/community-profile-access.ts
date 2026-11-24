// Is this signed-in person a "gym member" for the Community profile rules: gym staff, or a member holding a live gym Membership? Kept apart from the pure
// rules in community-profile.ts because it reads the live account and entitlements.
import { isGymStaff } from "@/lib/community-gym";
import type { StoredUser } from "@/lib/db";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";

export function isGymMemberOrStaff(user: Pick<StoredUser, "id" | "role">): boolean {
  return isGymStaff(user) || resolveMemberAccessForUser(user.id).gymMembership;
}
