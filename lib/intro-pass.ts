// The trial pass (owner request 2026-11-25): a one-off pass, for example 3 classes for €50, for anyone new who wants to try the gym without joining. It can be bought ONCE per
// member, and only BEFORE any membership has been paid for; once a membership exists the option disappears from the member's account.
//
// A package is a trial pass when its `introOnly` flag is set (Staff > Catalog > package, "Trial pass"). The price and the number of classes are ordinary catalogue settings.
// The rule lives here, once, and is applied both where the catalogue is shown and where checkout is started, so hiding the option is never the only thing that enforces it.
import { findMembershipPackageById, findPurchasesByUserId, findSubscriptionByUserId, type MembershipPackageRecord } from "./db";

export function isIntroPackage(pkg: Pick<MembershipPackageRecord, "introOnly" | "packageType"> | undefined | null): boolean {
  return pkg?.introOnly === true && pkg.packageType === "pass";
}

/** True once the member has (or ever had) a membership: a subscription that got past "not started", or a paid membership purchase. */
export function hasEverHadMembership(userId: string): boolean {
  const sub = findSubscriptionByUserId(userId);
  if (sub && sub.status !== "inactive" && sub.status !== "pending") return true;
  return findPurchasesByUserId(userId).some((p) => p.kind === "membership" && p.status === "paid");
}

/** True once the member has paid for any trial pass (a refunded one does not count, so they can try again). */
export function hasBoughtIntroPass(userId: string): boolean {
  return findPurchasesByUserId(userId).some((p) => {
    if (p.kind !== "pass_pack" || p.status !== "paid") return false;
    return isIntroPackage(findMembershipPackageById(p.productId));
  });
}

/** Whether the trial pass may be shown to, and bought by, this member. */
export function introPassAvailableTo(userId: string): boolean {
  return !hasEverHadMembership(userId) && !hasBoughtIntroPass(userId);
}

export const INTRO_PASS_UNAVAILABLE_MESSAGE = "The trial pass is only for new members who have not joined yet, and can be bought once.";
