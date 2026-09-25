import { isPlatformOperator, roleRank } from "@/lib/permissions";

// True when `target` is a platform_operator account and `actor` is not one.
// Account-security and role tools that act on another user (reset link, login
// email change, role change, archive) treat such a target as "not found": the
// operator role gates gym moderation, platform Finance and platform jobs, so it
// must not be reachable by resetting, re-emailing, demoting or deactivating the
// account from a tenant role that happens to share its gym (gymId null).
export function protectedOperatorTarget(actor: { role?: string | null }, target: { role?: string | null }): boolean {
  return isPlatformOperator(target.role) && !isPlatformOperator(actor.role);
}

// True when `target` holds a role that ranks STRICTLY above the actor's (canonical
// ROLE_RANK in lib/permissions.ts). An account-security tool must not act on a
// higher-ranked account — e.g. a gym admin minting a reset link for, or
// changing the login email of, the admin_manager who owns the gym, which would
// take the account over. Equal-rank and lower-rank targets are unaffected (the
// capability checks still decide those). The legacy "staff" alias ranks as
// admin_manager; null, undefined and unknown roles rank as member. A
// platform_operator outranks every tenant role, so this also covers
// protectedOperatorTarget for the routes that use both.
export function targetOutranksActor(actor: { role?: string | null }, target: { role?: string | null }): boolean {
  return roleRank(target.role) > roleRank(actor.role);
}
