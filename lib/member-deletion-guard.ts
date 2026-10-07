// Hard deletion of a member must never orphan a paid Google Play subscription.
//
// A member's Google Play subscription is billed by Google, not by this app, and only the member can cancel it in Google
// Play. If their account (and its purchase record) were deleted while it was still entitled, Google would keep billing, later
// notifications would find no owner, and the paid entitlement would be untracked. So a hard delete is REFUSED while a
// protected Play entitlement exists, with a stable code, and nothing is cancelled or refunded automatically.
//
// Protected: active, past_due (grace), paused, and cancelled-but-still-inside-the-paid-period. Ended entitlements (expired,
// on hold, revoked or refunded) do not block deletion. When deletion proceeds, purchase records are ANONYMISED rather than
// deleted (see lib/db.ts deleteUserAndOwnedRecords): the token, order, status and dates are kept so the token stays owned and a
// late notification can still be reconciled, but the record no longer names the member.

import { createHash } from "crypto";

export const ACTIVE_SUBSCRIPTION_CODE = "active_subscription" as const;

// Stable, non-sensitive. No token, order id, date or provider text.
export const ACTIVE_SUBSCRIPTION_MESSAGE =
  "This member has an active Google Play subscription. It can only be cancelled in Google Play, and deleting the account now would leave a paid subscription untracked. Try again once it has ended.";

export class MemberDeletionRefused extends Error {
  readonly code = ACTIVE_SUBSCRIPTION_CODE;
  /** Which protected state applies: a short status word, never a token. */
  readonly state: string;
  constructor(state: string) {
    super(ACTIVE_SUBSCRIPTION_MESSAGE);
    this.name = "MemberDeletionRefused";
    this.state = state;
  }
}

// An anonymised purchase record names this instead of a member. It can never equal a real user id (real ids are UUIDs).
export const DELETED_OWNER_PREFIX = "deleted:";

export function deletedOwnerId(userId: string): string {
  return `${DELETED_OWNER_PREFIX}${createHash("sha256").update(`member-deletion:${userId}`).digest("hex").slice(0, 16)}`;
}

export const isDeletedOwner = (userId: string | null | undefined): boolean => !!userId && userId.startsWith(DELETED_OWNER_PREFIX);
