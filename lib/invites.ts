import { findInviteByToken, findUserById, redeemInvite, type InviteRecord, type StoredUser } from "@/lib/db";
import { grantMemberTier } from "@/lib/tier-grant";

export interface RedeemInviteResult {
  ok: boolean;
  message: string;
  invite?: InviteRecord;
}

// Result of resolving an invite-carrying signup's gym, BEFORE the account
// exists. Three cases, never conflated:
//  - "none": no invite token was supplied at all — ordinary self-signup.
//    Callers apply the current, explicitly temporary single-gym default
//    (create in the primary gym) for this case only.
//  - "valid": a token was supplied and resolves cleanly — gymId is the
//    inviter's own gym (or null for the primary gym).
//  - "invalid": a token was supplied but is unusable for ANY reason
//    (missing, redeemed, revoked, expired, wrong email, or an inviter whose
//    account no longer resolves). Callers MUST reject the signup outright
//    with a generic, non-enumerating error — never fall back to creating a
//    primary-gym account. A supplied invite is an explicit statement of
//    intent ("I'm joining Gym B"); silently placing that person in Gym A
//    instead would be a real cross-tenant misassignment, not a harmless
//    degrade. This is a deliberate exception to redeemInviteForUser's own
//    "an invite problem never blocks the action" policy below, which still
//    applies to the tier GRANT (existing accounts, and the post-creation
//    redemption call) — it never applied to which GYM an account belongs to
//    in the first place, because that concept didn't exist until now.
export type InviteGymResolution =
  | { kind: "none" }
  | { kind: "valid"; gymId: string | null }
  | { kind: "invalid" };

// Resolves the gym a BRAND-NEW account should be created in when signup
// carries an invite token — called BEFORE the account exists (see the
// signup routes), so the account is born with the right gym rather than
// created wrong and patched afterward. There is no "reassign a user's gym"
// path anywhere in this codebase, and this function deliberately doesn't add
// one: UserRecord.gymId is set once, at creation, and never mutated (see
// docs/tenant-boundary-audit-2026-09.md's immutable-gymId finding).
//
// Callers pass a non-empty token — the "no token supplied" case is the
// caller's own { kind: "none" } branch, not this function's concern, so its
// signature only ever returns "valid" or "invalid".
//
// An inviter that resolves with gymId: null is the PRIMARY gym (the
// existing null-means-primary-gym convention, lib/gym-scope.ts) — a fully
// valid, resolved value, not "no gym". There is no separate "platform-wide
// invitation" concept anywhere in this codebase for this to fall back to.
//
// Read-only: does not consume the invite. The one-time redemption (and the
// tier grant) still happens via redeemInviteForUser after the account
// exists, exactly as before this function was added — but only ever runs
// for a token this function already classified "valid"; an "invalid" token
// never reaches account creation, let alone redemption.
export function resolveInviteGymId(token: string, email: string): InviteGymResolution {
  const invite = findInviteByToken(token);
  if (!invite || invite.status !== "pending") return { kind: "invalid" };
  if (invite.email !== email.toLowerCase()) return { kind: "invalid" };

  const inviter = findUserById(invite.invitedByStaffId);
  if (!inviter) return { kind: "invalid" };

  return { kind: "valid", gymId: inviter.gymId ?? null };
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
