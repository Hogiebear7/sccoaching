import type { MembershipPackageRecord, SubscriptionRecord } from "@/lib/db";

// Which group a member falls in on the staff member lists (owner request 2026-10-29). The lists show "current" (with "paused") by default;
// "past" and "none" are a filter away, and search always covers everyone.
//   current: a gym package, active or past due (the period may have lapsed: the lapse jobs end it a few days later)
//   paused:  a gym package, paused by staff
//   past:    a gym package that has ended (canceled or inactive)
//   none:    no gym package at all: never had one, only the App Subscription, or a checkout still pending
export type MemberListGroup = "current" | "paused" | "past" | "none";

export function memberListGroup(
  subscription: Pick<SubscriptionRecord, "packageId" | "status"> | undefined | null,
  findPackage: (id: string) => Pick<MembershipPackageRecord, "deliveryChannel"> | undefined
): MemberListGroup {
  if (!subscription?.packageId) return "none";
  const pkg = findPackage(subscription.packageId);
  if (!pkg || pkg.deliveryChannel === "app_only") return "none";
  switch (subscription.status) {
    case "active":
    case "past_due":
      return "current";
    case "paused":
      return "paused";
    case "canceled":
    case "inactive":
      return "past";
    default:
      return "none";
  }
}
