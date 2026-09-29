import { findInviteByToken, findUserById, redeemInvite, type InviteRecord, type StoredUser } from "@/lib/db";
import { grantMemberTier } from "@/lib/tier-grant";

export interface RedeemInviteResult {
  ok: boolean;
  message: string;
  invite?: InviteRecord;
}

// Resolves the gym a BRAND-NEW account should be created in when signup
// carries an invite token — called BEFORE the account exists (see the
// signup routes), so the account is born with the right gym rather than
// created wrong and patched afterward. There is no "reassign a user's gym"
// path anywhere in this codebase, and this function deliberately doesn't add
// one: UserRecord.gymId is set once, at creation, and never mutated (see
// docs/tenant-boundary-audit-2026-09.md's immutable-gymId finding).
//
// Returns:
//  - a gym id (or null for the primary gym) when the invite is genuinely
//    pending, addressed to this exact email, and its inviter resolves to a
//    real account;
//  - undefined for every other case (missing/redeemed/revoked/expired
//    invite, a different email, or an inviter whose account no longer
//    resolves) — meaning "no gym signal from this invite," never a guessed
//    gym. This deliberately mirrors every other invite-failure mode
//    redeemInviteForUser below already treats as non-blocking: the account
//    is still created exactly as it would be with no token at all, just
//    without a gym signal. Fails closed on the GYM ASSIGNMENT specifically —
//    it never invents an owner — while preserving the existing "an invite
//    problem never blocks signup" policy.
//
// Read-only: does not consume the invite. The one-time redemption (and the
// tier grant) still happens via redeemInviteForUser after the account
// exists, exactly as before this function was added.
export function resolveInviteGymId(token: string, email: string): string | null | undefined {
  const invite = findInviteByToken(token);
  if (!invite || invite.status !== "pending") return undefined;
  if (invite.email !== email.toLowerCase()) return undefined;

  const inviter = findUserById(invite.invitedByStaffId);
  if (!inviter) return undefined;

  return inviter.gymId ?? null;
}

// Shared by the standalone redemption route (member already has an account)
// and both signup routes (new account created with an inviteToken in the
// body) — both cases boil down to "this token, for this user, if the email
// matches." One-time use: redeemInvite() only succeeds from "pending".
export async function redeemInviteForUser(token: string, user: Pick<StoredUser, "id" | "email">): Promise<RedeemInviteResult> {
  const invite = findInviteByToken(token);

  if (!invite) {
    return { ok: false, message: "This invite link isn't valid." };
  }

  if (invite.status === "redeemed") {
    return { ok: false, message: "This invite has already been used.", invite };
  }

  if (invite.status === "revoked") {
    return { ok: false, message: "This invite has been cancelled.", invite };
  }

  if (invite.status === "expired") {
    return { ok: false, message: "This invite has expired. Ask staff to send a new one.", invite };
  }

  if (invite.email !== user.email.toLowerCase()) {
    return { ok: false, message: "This invite was sent to a different email address.", invite };
  }

  const grant = await grantMemberTier(user.id, invite.tier);
  if (!grant.ok) {
    return { ok: false, message: grant.message, invite };
  }

  const redeemed = redeemInvite(invite.id, user.id);
  if (!redeemed) {
    // Lost a race with another redemption attempt between lookup and here —
    // the tier grant above already applied, so surface success but note it.
    return { ok: true, message: grant.message, invite };
  }

  return { ok: true, message: "Invite redeemed — welcome!", invite: redeemed };
}
