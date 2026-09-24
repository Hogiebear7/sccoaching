import { isPlatformOperator } from "@/lib/permissions";

// True when `target` is a platform_operator account and `actor` is not one.
// Account-security and role tools that act on another user (reset link, login
// email change, role change, archive) treat such a target as "not found": the
// operator role gates gym moderation, platform Finance and platform jobs, so it
// must not be reachable by resetting, re-emailing, demoting or deactivating the
// account from a tenant role that happens to share its gym (gymId null).
export function protectedOperatorTarget(actor: { role?: string | null }, target: { role?: string | null }): boolean {
  return isPlatformOperator(target.role) && !isPlatformOperator(actor.role);
}
