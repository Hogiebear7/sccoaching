// Member-facing feature gating — the counterpart to lib/permissions.ts's
// staff role/capability system, but deliberately a separate module rather
// than an extension of it: permissions.ts's rank scale means "staff
// seniority" (coach < admin < admin_manager); tier means "what a member is
// currently entitled to" (free < app_subscription / membership). Overloading
// one scale to mean both would make neither read correctly.
//
// Mirrored byte-for-byte in sc-coaching-mobile/src/lib/member-access.ts (same
// "ported pure logic" pattern already used for gramsForServing/
// nutritionForGrams and the food-submission eligibility check) so the client
// never shows something the server would actually reject.

export type MemberTier = "free" | "app_subscription" | "membership";

export type MemberFeature =
  | "workoutGenerate"
  | "trackerImport"
  | "workoutReview"
  | "foodSearch"
  | "unlimitedCustomFoods"
  | "nutritionMoreTools"
  | "gymProfiles"
  | "notifications";

// App Subscription and Membership rank equal for every feature gated here —
// the one place they currently differ (Schedule/next-session) is explicitly
// out of scope for this pass, so it isn't represented in this map at all.
const TIER_RANK: Record<MemberTier, number> = {
  free: 0,
  app_subscription: 1,
  membership: 1,
};

const FEATURE_MIN_TIER: Record<MemberFeature, MemberTier> = {
  workoutGenerate: "app_subscription",
  trackerImport: "app_subscription",
  workoutReview: "app_subscription",
  foodSearch: "app_subscription",
  unlimitedCustomFoods: "app_subscription",
  nutritionMoreTools: "app_subscription",
  gymProfiles: "app_subscription",
  notifications: "app_subscription",
};

export function hasAccess(tier: MemberTier, feature: MemberFeature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]];
}

// Free tier's custom-food/quick-add cap — enforced both server-side
// (food/custom/create route) and, softer, client-side for an early heads-up
// before the member fills out the whole form.
export const FREE_CUSTOM_FOOD_LIMIT = 10;
