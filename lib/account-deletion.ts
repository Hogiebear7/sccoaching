// Member-initiated account deletion (Apple App Store guideline 5.1.1(v) and Google Play's account-deletion policy require an in-app way to
// start it). The destructive work is the existing deleteUserAndOwnedRecords (lib/db.ts), which already removes every member-owned
// record, anonymises Google Play purchase records, and REFUSES while a Google Play entitlement is still running. This module adds only the rules
// specific to a member deleting THEIR OWN account:
//
//  - members only. Staff and admin accounts own gym data and are removed by a gym administrator, not by self-service;
//  - a live Stripe or Revolut subscription blocks deletion until it is cancelled. Deleting the account would otherwise leave a paid
//    subscription billing with nobody to cancel it or receive its webhooks (owner decision 6 in the deletion docs is still open, so this
//    refuses rather than guessing). A checkout still in flight blocks it for the same reason: a late payment would find no account;
//  - a manual, gym-granted plan (provider "none") never blocks: nothing is billed.
//
// Nothing here cancels, refunds or contacts a provider.
import type { SubscriptionRecord } from "@/lib/db";

export const DELETE_CONFIRM_WORD = "DELETE";

export type SelfDeletionBlockCode = "staff_account" | "active_subscription" | "payment_in_progress";

export interface SelfDeletionBlock {
  code: SelfDeletionBlockCode;
  status: 403 | 409;
  message: string;
}

export const STAFF_ACCOUNT_MESSAGE = "Staff and admin accounts are removed by a gym administrator. Ask your gym to remove your account.";
export const ACTIVE_PAID_SUBSCRIPTION_MESSAGE =
  "You have an active paid membership. Cancel it first (Settings, then Manage membership, or ask your gym), then delete your account. Deleting now would leave a paid membership with no account.";
export const PAYMENT_IN_PROGRESS_MESSAGE =
  "A payment for your membership is still in progress. Wait for it to finish or expire, or ask your gym to cancel it, then delete your account.";

export const GOOGLE_PLAY_ACTIVE_MESSAGE =
  "You have an active App Subscription bought through Google Play or the App Store. It can only be cancelled there, and deleting your account does not cancel it. Cancel it in the store, wait until it has ended, then delete your account.";

const LIVE_PAID_STATUSES = new Set<SubscriptionRecord["status"]>(["active", "past_due", "paused"]);

/** Returns why this member cannot delete their own account right now, or null if they can. Google Play entitlements are enforced separately by the datastore. */
export function selfDeletionBlock(role: string, subscription: SubscriptionRecord | undefined): SelfDeletionBlock | null {
  if (role !== "member") return { code: "staff_account", status: 403, message: STAFF_ACCOUNT_MESSAGE };
  if (!subscription || subscription.provider === "none" || subscription.provider === "google_play") return null;
  if (LIVE_PAID_STATUSES.has(subscription.status)) return { code: "active_subscription", status: 409, message: ACTIVE_PAID_SUBSCRIPTION_MESSAGE };
  if (subscription.status === "pending") return { code: "payment_in_progress", status: 409, message: PAYMENT_IN_PROGRESS_MESSAGE };
  return null;
}
