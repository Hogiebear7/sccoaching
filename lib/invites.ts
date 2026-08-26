import { findInviteByToken, redeemInvite, type InviteRecord, type StoredUser } from "@/lib/db";
import { grantMemberTier } from "@/lib/tier-grant";

export interface RedeemInviteResult {
  ok: boolean;
  message: string;
  invite?: InviteRecord;
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
